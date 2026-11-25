import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import {
  evaluateGroupMessage,
  generateLocalGroupReply,
  GroupModerationRules,
  ModerationSensitivity,
} from '@/lib/moderation-engine';

async function callTelegramApi(method: string, payload: Record<string, unknown>): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(res.ok && json?.ok);
  } catch {
    return false;
  }
}

async function sendTelegramMessage(chatId: number | string, text: string, replyMarkup?: Record<string, unknown>) {
  await callTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function deleteTelegramMessage(chatId: number | string, messageId: number): Promise<boolean> {
  return callTelegramApi('deleteMessage', {
    chat_id: chatId,
    message_id: messageId,
  });
}

async function restrictTelegramMember(chatId: number | string, userId: number, muteMinutes: number): Promise<boolean> {
  const untilDate = Math.floor(Date.now() / 1000) + Math.max(1, muteMinutes) * 60;
  return callTelegramApi('restrictChatMember', {
    chat_id: chatId,
    user_id: userId,
    until_date: untilDate,
    permissions: {
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_other_messages: false,
    },
  });
}

async function isTelegramGroupAdmin(chatId: number | string, userId: number): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(String(chatId))}&user_id=${userId}`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: { status?: string } } | null;
    const st = data?.result?.status;
    return Boolean(data?.ok && (st === 'creator' || st === 'administrator'));
  } catch {
    return false;
  }
}

function buildStartKeyboard(appUrl: string) {
  const cleanUrl = appUrl.replace(/\/$/, '');
  return {
    inline_keyboard: [
      [{ text: 'ورود به مدار', web_app: { url: cleanUrl } }],
      [
        { text: 'بازی‌ها و دورهمی', web_app: { url: `${cleanUrl}?tab=games` } },
        { text: 'ونوس و Blind Date', web_app: { url: `${cleanUrl}?tab=venus` } },
      ],
      [
        { text: 'نجوای ناشناس', web_app: { url: `${cleanUrl}?tab=whisper` } },
        { text: 'پروفایل من', web_app: { url: `${cleanUrl}?tab=profile` } },
      ],
      [{ text: 'راهنما', callback_data: 'madar_help' }],
    ],
  };
}

export async function POST(req: NextRequest) {
  // Mandatory webhook secret in production; always timing-safe verification when set
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || '';
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && !expectedSecret) {
    return NextResponse.json({ error: 'Webhook unavailable' }, { status: 503 });
  }

  if (expectedSecret) {
    const incoming = req.headers.get('x-telegram-bot-api-secret-token') || '';
    const a = crypto.createHash('sha256').update(incoming).digest();
    const b = crypto.createHash('sha256').update(expectedSecret).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const update = await req.json().catch(() => null);
  if (!update || typeof update !== 'object') {
    return NextResponse.json({ ok: true });
  }

  const callbackQuery = update.callback_query;
  const message = update.message;
  const appUrl = (process.env.APP_URL || 'https://example.com').replace(/\/$/, '');
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || 'MadarBot').toLowerCase();

  // 1. Inline Keyboard callbacks
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
            text: `${fromName} به «${target.name}» رأی داد.`,
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
              `رأی ${fromName} برای «${target.name}» ثبت شد.`
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
        `اتاق ${roomCode}: نقش مخفی شما فقط در همین گفت‌وگو و مینی‌اپ نمایش داده می‌شود.`,
        {
          inline_keyboard: [[{ text: 'باز کردن میز بازی', web_app: { url: `${appUrl}?tab=games` } }]],
        }
      );
      return NextResponse.json({ ok: true, handled: 'mafia_dm' });
    }

    if (cbData === 'madar_help' && fromId) {
      await sendTelegramMessage(
        fromId,
        'راهنمای مدار:\n• از دکمه ورود به مدار برای بازی‌های دورهمی، آشنایی ونوس و نجوای ناشناس استفاده کنید.\n• در گروه‌ها سپر محلی ضدلینک، ضدتبلیغ، ضداسپم و ضدتبچی بدون نیاز به سرویس خارجی فعال است.'
      );
      return NextResponse.json({ ok: true, handled: 'help' });
    }
  }

  // 2. Messages (Private + Group)
  if (message?.chat) {
    const chatId = message.chat.id;
    const chatType: string = message.chat.type;
    const text: string = String(message.text || message.caption || '').trim();
    const fromId: number | undefined = typeof message.from?.id === 'number' ? message.from.id : undefined;
    const fromName: string = message.from?.first_name || 'کاربر مدار';
    const messageId: number | undefined = typeof message.message_id === 'number' ? message.message_id : undefined;

    if (chatType === 'private' && text.startsWith('/start')) {
      const payload = text.split(' ')[1] || '';
      let extraNote = '';
      if (payload.startsWith('ref_')) {
        extraNote = `\nکد دعوت ${payload} ثبت شد.`;
      } else if (payload.startsWith('anon_')) {
        extraNote = `\nبرای ارسال نجوای ناشناس به @${payload.slice(5)} وارد مدار شو.`;
      } else if (payload.startsWith('room_')) {
        extraNote = `\nاتاق بازی ${payload.slice(5)} آماده است.`;
      }

      const welcome = `سلام ${fromName}! به مدار خوش آمدی.${extraNote}`;
      await sendTelegramMessage(chatId, welcome, buildStartKeyboard(appUrl));
      return NextResponse.json({ ok: true, handled: 'start' });
    }

    if (chatType === 'group' || chatType === 'supergroup') {
      const db = getDb();

      // Register group automatically if bot receives messages in a new group
      let grp = db.prepare('SELECT * FROM telegram_groups WHERE chat_id = ?').get(String(chatId)) as
        | (GroupModerationRules & {
            id: number;
            title: string;
            rules_text: string;
            welcome_text: string;
            ai_enabled: number;
            sensitivity_level: ModerationSensitivity;
            anti_tabchi: number;
            mute_duration_minutes: number;
          })
        | undefined;

      if (!grp && message.chat.title) {
        const ins = db
          .prepare('INSERT INTO telegram_groups (chat_id, title, bot_is_admin) VALUES (?, ?, 1)')
          .run(String(chatId), String(message.chat.title).slice(0, 80));
        grp = db.prepare('SELECT * FROM telegram_groups WHERE id = ?').get(Number(ins.lastInsertRowid)) as typeof grp;
      }

      if (text.startsWith('/mafia')) {
        const activeRoom = db
          .prepare("SELECT room_code, players_json FROM game_rooms WHERE game_type = 'mafia' AND status = 'active' ORDER BY id DESC LIMIT 1")
          .get() as { room_code: string; players_json: string } | undefined;
        const code = activeRoom?.room_code || 'MDR-LIVE';
        const players = activeRoom
          ? (JSON.parse(activeRoom.players_json) as { id: string; name: string; alive: boolean }[]).filter((p) => p.alive).slice(0, 4)
          : [];
        const voteRows = players.map((p) => [{ text: `رأی به ${p.name}`, callback_data: `mafia_vote:${code}:${p.id}` }]);
        await sendTelegramMessage(chatId, `مافیا مدار (اتاق ${code})`, {
          inline_keyboard: [
            ...voteRows,
            [{ text: 'نقش مخفی در پی‌وی', callback_data: `mafia_dm:${code}` }],
            [{ text: 'باز کردن میز بازی', web_app: { url: `${appUrl}?tab=games` } }],
          ],
        });
        return NextResponse.json({ ok: true, handled: 'group_mafia' });
      }

      if (grp) {
        const hasMedia = Boolean(
          message.photo || message.video || message.document || message.sticker || message.animation || message.voice
        );
        const isForwarded = Boolean(message.forward_origin || message.forward_from || message.forward_from_chat);
        const entities = Array.isArray(message.entities) ? message.entities : [];
        const mentionCount = entities.filter(
          (e: { type?: string }) => e?.type === 'mention' || e?.type === 'text_mention'
        ).length;

        // Skip moderation enforcement on real group admins
        const senderIsAdmin = fromId ? await isTelegramGroupAdmin(chatId, fromId) : false;

        if (!senderIsAdmin) {
          const decision = evaluateGroupMessage(text, hasMedia, grp, {
            groupId: grp.id,
            senderKey: String(fromId || fromName),
            hasMedia,
            isForwarded,
            mentionCount,
          });

          if (!decision.allowed) {
            let deleted = false;
            let muted = false;

            if (messageId && (decision.action === 'delete' || decision.action === 'mute')) {
              deleted = await deleteTelegramMessage(chatId, messageId);
            }
            if (fromId && decision.action === 'mute') {
              muted = await restrictTelegramMember(chatId, fromId, decision.muteMinutes || grp.mute_duration_minutes || 10);
            }
            if (decision.action === 'warn') {
              await sendTelegramMessage(chatId, `تذکر به ${fromName}: ${decision.reason}`);
            }

            const execNote = [
              decision.reason,
              deleted ? 'پیام حذف شد' : null,
              muted ? `کاربر ${decision.muteMinutes || 10} دقیقه محدود شد` : null,
            ]
              .filter(Boolean)
              .join(' · ');

            db.prepare(
              "INSERT INTO moderation_logs (group_id, command, target_label, reason, actor_label) VALUES (?, ?, ?, ?, 'موتور محلی زحل')"
            ).run(grp.id, `auto:${decision.action}`, fromName, execNote);

            return NextResponse.json({ ok: true, moderation: decision, executed: { deleted, muted } });
          }
        }

        if (text === '/rules' || text === '/status' || text === '/help' || (text.toLowerCase().includes(`@${botUsername}`) && grp.ai_enabled)) {
          const activeProtections: string[] = [];
          if (grp.anti_link) activeProtections.push('ضدلینک');
          if (grp.anti_ads) activeProtections.push('ضدتبلیغ');
          if (grp.anti_spam) activeProtections.push('ضداسپم');
          if (grp.anti_flood) activeProtections.push('ضدFlood');
          if (grp.anti_tabchi) activeProtections.push('ضدتبچی');
          if (grp.lock_media) activeProtections.push('قفل رسانه');

          const cleanedPrompt = text.replace(new RegExp(`@${botUsername}`, 'ig'), '').trim() || '/help';
          const localRes = generateLocalGroupReply({
            groupTitle: grp.title,
            rulesText: grp.rules_text || '',
            welcomeText: grp.welcome_text || '',
            userMessage: cleanedPrompt,
            senderName: fromName,
            activeProtections,
          });
          await sendTelegramMessage(chatId, localRes.text);
          return NextResponse.json({ ok: true, handled: 'local_group_reply' });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
