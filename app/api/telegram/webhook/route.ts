import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { evaluateGroupMessage, GroupModerationRules } from '@/lib/moderation-engine';
import { askMadarGroupAssistant } from '@/lib/gemini';

async function sendTelegramMessage(chatId: number | string, text: string, replyMarkup?: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
    }),
  });
}

function buildStartKeyboard(appUrl: string) {
  const cleanUrl = appUrl.replace(/\/$/, '');
  return {
    inline_keyboard: [
      [{ text: '🚀 ورود به جهان مدار', web_app: { url: cleanUrl } }],
      [
        { text: '👤 پروفایل من', web_app: { url: `${cleanUrl}?tab=profile` } },
        { text: '💫 ستاره‌های من', web_app: { url: `${cleanUrl}?tab=shop` } },
      ],
      [
        { text: '🎮 بازی‌ها', web_app: { url: `${cleanUrl}?tab=games` } },
        { text: '💌 نجوا', web_app: { url: `${cleanUrl}?tab=whisper` } },
      ],
      [
        { text: '🌌 دعوت دوستان', callback_data: 'madar_referral' },
        { text: '⚙️ تنظیمات', web_app: { url: `${cleanUrl}?tab=profile` } },
      ],
      [{ text: '🛟 راهنما', callback_data: 'madar_help' }],
    ],
  };
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const incoming = req.headers.get('x-telegram-bot-api-secret-token') || '';
    const a = crypto.createHash('sha256').update(incoming).digest();
    const b = crypto.createHash('sha256').update(expectedSecret).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorized webhook secret' }, { status: 401 });
    }
  }

  const update = await req.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true });

  const callbackQuery = update.callback_query;
  const message = update.message;
  const appUrl = (process.env.APP_URL || 'https://example.com').replace(/\/$/, '');
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || 'MadarBot').toLowerCase();

  // 0. Handle Inline Keyboard callbacks (Tri-Mode Game Voting in Group + Private DM Role Delivery)
  if (callbackQuery?.data) {
    const cbData: string = String(callbackQuery.data);
    const fromId = callbackQuery.from?.id;
    const fromName: string = callbackQuery.from?.first_name || 'بازیکن';
    const db = getDb();

    if (cbData.startsWith('mafia_vote:')) {
      const [, roomCode, targetId] = cbData.split(':');
      const room = db.prepare('SELECT * FROM game_rooms WHERE room_code = ?').get(roomCode) as Record<string, unknown> | undefined;
      if (room) {
        const players = JSON.parse(String(room.players_json || '[]')) as { id: string; name: string; alive: boolean }[];
        const votes = JSON.parse(String(room.votes_json || '{}')) as Record<string, string>;
        const log = JSON.parse(String(room.channel_log_json || '[]')) as { channel: string; text: string; at: string }[];
        const target = players.find((p) => p.id === targetId && p.alive);
        if (target) {
          votes[`tg_${fromId}`] = target.id;
          log.unshift({
            channel: 'telegram_group',
            text: `${fromName} از طریق دکمه شیشه‌ای گروه به «${target.name}» رأی داد.`,
            at: new Date().toISOString().slice(11, 19),
          });
          db.prepare("UPDATE game_rooms SET votes_json = ?, channel_log_json = ?, updated_at = datetime('now') WHERE room_code = ?").run(
            JSON.stringify(votes),
            JSON.stringify(log.slice(0, 15)),
            roomCode
          );
          if (callbackQuery.message?.chat?.id) {
            await sendTelegramMessage(
              callbackQuery.message.chat.id,
              `✅ رأی ${fromName} برای «${target.name}» در اتاق ${roomCode} ثبت و با Mini App همگام شد.`
            );
          }
        }
      }
      return NextResponse.json({ ok: true, handled: 'mafia_vote' });
    }

    if (cbData.startsWith('mafia_dm:') && fromId) {
      const roomCode = cbData.split(':')[1];
      await sendTelegramMessage(
        fromId,
        `🔒 پیام محرمانه ربات مدار (اتاق ${roomCode}):\nنقش مخفی شما فقط در همین گفت‌وگوی خصوصی نمایش داده می‌شود. برای مشاهده نقشه زنده شهر و رأی‌های هم‌زمان، دکمه زیر را لمس کن.`,
        {
          inline_keyboard: [[{ text: '🎮 مشاهده وضعیت زنده در Mini App', web_app: { url: `${appUrl}?tab=games` } }]],
        }
      );
      return NextResponse.json({ ok: true, handled: 'mafia_dm' });
    }

    if (cbData === 'madar_help' && fromId) {
      await sendTelegramMessage(
        fromId,
        'راهنمای مدار:\n• بازی‌ها هم‌زمان در گروه (دکمه شیشه‌ای)، پی‌وی ربات (نقش مخفی) و Mini App (نمای گرافیکی) اجرا می‌شوند.\n• پروفایل اجتماعی و پروفایل آشنایی ونوس کاملاً از هم جدا هستند.'
      );
      return NextResponse.json({ ok: true, handled: 'help' });
    }
  }

  if (message?.chat && typeof message.text === 'string') {
    const chatId = message.chat.id;
    const chatType: string = message.chat.type;
    const text: string = message.text.trim();
    const fromName: string = message.from?.first_name || 'کاربر مدار';

    // 1. Private /start handler (with ref_ or anon_ deep links)
    if (chatType === 'private' && text.startsWith('/start')) {
      const payload = text.split(' ')[1] || '';
      let extraNote = '';
      if (payload.startsWith('ref_')) {
        extraNote = `\n\nکد دعوت ${payload} شناسایی شد. پس از تکمیل ثبت‌نام در Mini App، منظومه اجتماعی معرف گسترش می‌یابد و پاداش ستاره واریز می‌شود.`;
      } else if (payload.startsWith('anon_')) {
        const slug = payload.slice(5);
        extraNote = `\n\nبرای ارسال پیام ناشناس به @${slug}، دکمه زیر را لمس کن.`;
      } else if (payload.startsWith('room_')) {
        const code = payload.slice(5);
        extraNote = `\n\nاتاق بازی همگام ${code} آماده است! نقش مخفی شما در همین پی‌وی ارسال می‌شود و وضعیت زنده در Mini App قابل مشاهده است.`;
      }

      const welcome = `سلام ${fromName}! به کهکشان شخصی خودت در مدار خوش آمدی.\n\nزمین سیاره مرکزی توست؛ با فعالیت و بازی ستاره و نشان بگیر و با دعوت دوستان منظومه‌ات را بساز.${extraNote}`;
      await sendTelegramMessage(chatId, welcome, buildStartKeyboard(appUrl));
      return NextResponse.json({ ok: true, handled: 'start' });
    }

    // 2. Group moderation + Tri-Mode /mafia launcher + @MadarBot AI mention
    if (chatType === 'group' || chatType === 'supergroup') {
      const db = getDb();

      // Tri-Mode group game launcher (/mafia)
      if (text.startsWith('/mafia')) {
        const activeRoom = db
          .prepare("SELECT room_code, players_json FROM game_rooms WHERE game_type = 'mafia' AND status = 'active' ORDER BY id DESC LIMIT 1")
          .get() as { room_code: string; players_json: string } | undefined;
        const code = activeRoom?.room_code || 'MDR-LIVE';
        const players = activeRoom
          ? (JSON.parse(activeRoom.players_json) as { id: string; name: string; alive: boolean }[]).filter((p) => p.alive).slice(0, 4)
          : [];
        const voteRows = players.map((p) => [{ text: `🗳 رأی به ${p.name}`, callback_data: `mafia_vote:${code}:${p.id}` }]);
        await sendTelegramMessage(
          chatId,
          `🎭 مافیای سه‌حالته مدار (اتاق ${code})\n• رأی‌گیری: همین‌جا با دکمه‌های شیشه‌ای گروه\n• نقش مخفی: در پی‌وی خصوصی ربات\n• وضعیت زنده بازی: داخل Mini App`,
          {
            inline_keyboard: [
              ...voteRows,
              [{ text: '🔒 دریافت نقش مخفی در پی‌وی', callback_data: `mafia_dm:${code}` }],
              [{ text: '🌌 مشاهده میز زنده در Mini App', web_app: { url: `${appUrl}?tab=games` } }],
            ],
          }
        );
        return NextResponse.json({ ok: true, handled: 'group_mafia' });
      }

      const grp = db.prepare('SELECT * FROM telegram_groups WHERE chat_id = ?').get(String(chatId)) as
        | (GroupModerationRules & {
            id: number;
            title: string;
            rules_text: string;
            ai_enabled: number;
            ai_humor_level: string;
            ai_max_reply_chars: number;
            ai_daily_limit: number;
            ai_used_today: number;
            ai_allowed_topics: string;
          })
        | undefined;

      if (grp) {
        const decision = evaluateGroupMessage(text, Boolean(message.photo || message.video || message.document), grp);
        if (!decision.allowed) {
          db.prepare(
            "INSERT INTO moderation_logs (group_id, command, target_label, reason, actor_label) VALUES (?, ?, ?, ?, 'Webhook زحل')"
          ).run(grp.id, decision.action, fromName, decision.reason);
          return NextResponse.json({ ok: true, moderation: decision });
        }

        if (text === '/rules') {
          await sendTelegramMessage(chatId, `قوانین گروه ${grp.title}:\n\n${grp.rules_text}`);
          return NextResponse.json({ ok: true, handled: 'rules' });
        }

        if (text.toLowerCase().includes(`@${botUsername}`) && grp.ai_enabled && grp.ai_used_today < grp.ai_daily_limit) {
          try {
            const cleanedPrompt = text.replace(new RegExp(`@${botUsername}`, 'ig'), '').trim() || 'سلام!';
            const aiRes = await askMadarGroupAssistant({
              groupTitle: grp.title,
              humorLevel: grp.ai_humor_level,
              maxChars: grp.ai_max_reply_chars,
              allowedTopics: grp.ai_allowed_topics,
              userMessage: cleanedPrompt,
              senderName: fromName,
            });
            db.prepare('UPDATE telegram_groups SET ai_used_today = ai_used_today + 1 WHERE id = ?').run(grp.id);
            await sendTelegramMessage(chatId, aiRes.text);
          } catch {
            // Non-blocking: other bot capabilities remain operational if Gemini is unreachable
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
