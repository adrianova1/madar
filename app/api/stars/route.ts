import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adjustStarsAtomic, getDb } from '@/lib/db';
import { getAuthUser } from '@/lib/security';

const StarActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('claim_mission'),
    missionId: z.string().min(1).max(40),
  }),
  z.object({
    action: z.literal('buy_item'),
    itemId: z.string().min(1).max(40),
  }),
  z.object({
    action: z.literal('gift_stars'),
    recipientUsername: z.string().min(2).max(40),
    amount: z.number().int().min(5).max(500),
  }),
]);

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const wallet = db
    .prepare('SELECT free_stars, paid_stars FROM star_wallets WHERE user_id = ?')
    .get(auth.id) as { free_stars: number; paid_stars: number };

  const transactions = db
    .prepare('SELECT id, amount, star_bucket, tx_type, description, created_at FROM star_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 25')
    .all(auth.id);

  const shopItems = db.prepare('SELECT * FROM shop_items WHERE is_active = 1 ORDER BY price_stars ASC').all();
  const ownedIds = (
    db.prepare('SELECT item_id FROM user_inventory WHERE user_id = ?').all(auth.id) as { item_id: string }[]
  ).map((r) => r.item_id);

  const missions = db.prepare('SELECT * FROM daily_missions').all() as {
    id: string;
    title: string;
    description: string;
    reward_stars: number;
    action_target: string;
  }[];
  const claimedToday = new Set(
    (
      db.prepare('SELECT mission_id FROM user_missions WHERE user_id = ? AND mission_date = ?').all(auth.id, today) as {
        mission_id: string;
      }[]
    ).map((r) => r.mission_id)
  );

  const referralLeaderboard = db
    .prepare(`
      SELECT u.username, u.display_name, COUNT(r.id) as verified_invites, COALESCE(SUM(r.reward_stars), 0) as total_rewards
      FROM users u
      LEFT JOIN referral_events r ON r.referrer_user_id = u.id AND r.status = 'verified'
      WHERE u.is_deleted = 0 AND u.is_banned = 0
      GROUP BY u.id
      ORDER BY verified_invites DESC, u.xp DESC
      LIMIT 8
    `)
    .all();

  return NextResponse.json({
    wallet: {
      freeStars: wallet.free_stars,
      paidStars: wallet.paid_stars,
      totalStars: wallet.free_stars + wallet.paid_stars,
    },
    transactions,
    shopItems,
    ownedIds,
    missions: missions.map((m) => ({
      ...m,
      claimed: claimedToday.has(m.id),
    })),
    referralLeaderboard,
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = StarActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();
  const data = parsed.data;

  try {
    if (data.action === 'claim_mission') {
      const today = new Date().toISOString().slice(0, 10);
      const mission = db.prepare('SELECT * FROM daily_missions WHERE id = ?').get(data.missionId) as
        | { id: string; title: string; reward_stars: number }
        | undefined;
      if (!mission) return NextResponse.json({ error: 'مأموریت یافت نشد.' }, { status: 404 });

      const already = db
        .prepare('SELECT 1 FROM user_missions WHERE user_id = ? AND mission_id = ? AND mission_date = ?')
        .get(auth.id, mission.id, today);
      if (already) {
        return NextResponse.json({ error: 'پاداش این مأموریت امروز قبلاً دریافت شده است.' }, { status: 409 });
      }

      const wallet = db.transaction(() => {
        db.prepare('INSERT INTO user_missions (user_id, mission_id, mission_date) VALUES (?, ?, ?)').run(
          auth.id,
          mission.id,
          today
        );
        db.prepare('UPDATE users SET xp = xp + 25, level = 1 + ((xp + 25) / 150) WHERE id = ?').run(auth.id);
        return adjustStarsAtomic(auth.id, mission.reward_stars, 'free', 'mission_reward', `مأموریت روزانه: ${mission.title}`, `${mission.id}:${today}`);
      })();

      return NextResponse.json({ ok: true, wallet, message: `+${mission.reward_stars} ستاره به کیف‌پولت واریز شد.` });
    }

    if (data.action === 'buy_item') {
      const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND is_active = 1').get(data.itemId) as
        | { id: string; title: string; category: string; price_stars: number }
        | undefined;
      if (!item) return NextResponse.json({ error: 'آیتم موردنظر یافت نشد.' }, { status: 404 });

      const owns = db.prepare('SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?').get(auth.id, item.id);
      if (owns && item.category !== 'اشتراک ویژه') {
        return NextResponse.json({ error: 'این آیتم قبلاً برای حساب شما فعال شده است.' }, { status: 409 });
      }

      const wallet = db.transaction(() => {
        const nextW = adjustStarsAtomic(auth.id, -item.price_stars, 'free', 'shop_purchase', `خرید از فروشگاه: ${item.title}`, item.id);
        db.prepare('INSERT OR IGNORE INTO user_inventory (user_id, item_id) VALUES (?, ?)').run(auth.id, item.id);
        if (item.id === 'sub_plus_30d') {
          db.prepare("UPDATE users SET subscription_tier = 'plus' WHERE id = ?").run(auth.id);
        }
        return nextW;
      })();

      return NextResponse.json({ ok: true, wallet, message: `آیتم «${item.title}» با موفقیت خریداری و فعال شد.` });
    }

    if (data.action === 'gift_stars') {
      const uname = data.recipientUsername.trim().toLowerCase().replace(/^@/, '');
      const recipient = db
        .prepare('SELECT id, display_name FROM users WHERE lower(username) = ? AND is_deleted = 0')
        .get(uname) as { id: number; display_name: string } | undefined;
      if (!recipient) return NextResponse.json({ error: 'کاربر مقصد یافت نشد.' }, { status: 404 });
      if (recipient.id === auth.id) return NextResponse.json({ error: 'نمی‌توانید به خودتان ستاره هدیه دهید.' }, { status: 400 });

      const wallet = db.transaction(() => {
        const senderWallet = adjustStarsAtomic(
          auth.id,
          -data.amount,
          'free',
          'gift_sent',
          `هدیه ستاره به ${recipient.display_name}`
        );
        adjustStarsAtomic(recipient.id, data.amount, 'free', 'gift_received', `دریافت هدیه ستاره از @${auth.username}`);
        db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'stars', 'هدیه ستاره دریافت کردی!', ?)").run(
          recipient.id,
          `کاربر @${auth.username} تعداد ${data.amount} ستاره برای تو هدیه فرستاد.`
        );
        return senderWallet;
      })();

      return NextResponse.json({ ok: true, wallet, message: `${data.amount} ستاره به ${recipient.display_name} هدیه داده شد.` });
    }

    return NextResponse.json({ error: 'عملیات نامعتبر' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'خطا در انجام تراکنش ستاره';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
