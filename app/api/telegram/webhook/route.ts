import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import {
  evaluateGroupMessage,
  generateLocalGroupReply,
  GroupModerationRules,
  ModerationSensitivity,
} from '@/lib/moderation-engine';
import { logSystemError, normalizeTelegramPhone } from '@/lib/security';
import {
  callTelegramBot,
  getBotUsername,
  upsertTelegramUser,
  verifyForcedChannelMembership,
} from '@/lib/telegram-bot';

async function sendTelegramMessage(chatId: number | string, text: string, replyMarkup?: Record<string, unknown>) {
  await callTelegramBot('sendMessage', {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function answerCallback(callbackQueryId: string, text?: string, showAlert = false) {
  await callTelegramBot('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    show_alert: showAlert,
  });
}

async function deleteTelegramMessage(chatId: number | string, messageId: number): Promise<boolean> {
  const res = await callTelegramBot('deleteMessage', {
    chat_id: chatId,
    message_id: messageId,
  });
  return res.ok;
}

async function restrictTelegramMember(chatId: number | string, userId: number, muteMinutes: number): Promise<boolean> {
  const untilDate = Math.floor(Date.now() / 1000) + Math.max(1, muteMinutes) * 60;
  const res = await callTelegramBot('restrictChatMember', {
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
  return res.ok;
}

async function isTelegramGroupAdmin(chatId: number | string, userId: number): Promise<boolean> {
  const res = await callTelegramBot<{ status?: string }>('getChatMember', {
    chat_id: chatId,
    user_id: userId,
  });
  const st = res.result?.status;
  return Boolean(res.ok && (st === 'creator' || st === 'administrator'));
}

function getBotSettings(): { welcomeText: string; requirePhoneContact: boolean } {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'bot_settings'").get() as
      | { value_json: string }
      | undefined;
    if (row) {
      const parsed = JSON.parse(row.value_json);
      return {
        welcomeText: String(parsed.welcomeText || 'به مدار خوش آمدی.'),
        requirePhoneContact: parsed.requirePhoneContact !== false,
      };
    }
  } catch {
    // default below
  }
  return { welcomeText: 'به مدار خوش آمدی.', requirePhoneContact: true };
}

function buildForcedChannelsKeyboard(channels: { title: string; inviteUrl: string; joined: boolean }[]) {
  const missing = channels.filter((c) => !c.joined);
  const rows: Record<string, unknown>[][] = missing.map((ch) => [
    { text: `عضویت در ${ch.title}`, url: ch.inviteUrl },
  ]);
  rows.push([{ text: 'بررسی عضویت', callback_data: 'madar_check_channels' }]);
  return { inline_keyboard: rows };
}

function buildContactStepKeyboard(appUrl: string) {
  const cleanUrl = appUrl.replace(/\/$/, '');
  return {
    inline_keyboard: [
      [{ text: 'اشتراک‌گذاری شماره', web_app: { url: `${cleanUrl}?onboarding=contact` } }],
    ],
  };
}

function buildEnterMadarKeyboard(appUrl: string) {
  const cleanUrl = appUrl.replace(/\/$/, '');
  return {
    inline_keyboard: [
      [{ text: 'ورود به مدار', web_app: { url: cleanUrl } }],
      [
        { text: 'بازی‌ها و دورهمی', web_app: { url: `${cleanUrl}?tab=games` } },
        { text: 'ونوس', web_app: { url: `${cleanUrl}?tab=venus` } },
      ],
      [
        { text: 'نجوای ناشناس', web_app: { url: `${cleanUrl}?tab=whisper` } },
        { text: 'پروفایل من', web_app: { url: `${cleanUrl}?tab=profile` } },
      ],
    ],
  };
}

/**
 * Evaluates forced channel membership -> phone contact step -> full entry for private chat user.
 */
async function advancePrivateOnboarding(
  chatId: number,
  tgUserId: number,
  firstName: string,
  appUrl: string,
  extraNote = ''
): Promise<{ step: 'channels_required' | 'contact_required' | 'ready'; channels?: unknown }> {
  const db = getDb();
  const membership = await verifyForcedChannelMembership(tgUserId);

  if (!membership.allJoined) {
    await sendTelegramMessage(
      chatId,
      `سلام ${firstName}!\nبرای ورود به مدار، ابتدا عضو کانال‌های زیر شو و سپس روی «بررسی عضویت» بزن.`,
      buildForcedChannelsKeyboard(membership.channels)
    );
    return { step: 'channels_required', channels: membership.channels };
  }

  db.prepare("UPDATE users SET channel_verified_at = datetime('now') WHERE telegram_id = ?").run(String(tgUserId));

  const userRow = db
    .prepare('SELECT phone_verified, onboarding_completed FROM users WHERE telegram_id = ? AND is_deleted = 0')
    .get(String(tgUserId)) as { phone_verified: number; onboarding_completed: number } | undefined;

  const botSettings = getBotSettings();
  const phoneAlreadyVerified = Boolean(userRow?.phone_verified);

  if (botSettings.requirePhoneContact && !phoneAlreadyVerified) {
    await sendTelegramMessage(
      chatId,
      `عضویت شما تأیید شد.\nبرای تکمیل ورود به مدار، دکمه «اشتراک‌گذاری شماره» را بزنید تا پنجره رسمی تلگرام باز شود.`,
      buildContactStepKeyboard(appUrl)
    );
    return { step: 'contact_required' };
  }

  if (!userRow?.onboarding_completed) {
    db.prepare('UPDATE users SET onboarding_completed = 1 WHERE telegram_id = ?').run(String(tgUserId));
  }

  const welcomeBase = botSettings.welcomeText || 'به مدار خوش آمدی.';
  await sendTelegramMessage(
    chatId,
    `سلام ${firstName}! ${welcomeBase}${extraNote}`,
    buildEnterMadarKeyboard(appUrl)
  );
  return { step: 'ready' };
}

export async function POST(req: NextRequest) {
  // Mandatory webhook secret in production; always timing-safe verification when set
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || '';
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && !expectedSecret) {
    logSystemError('telegram_webhook', 'TELEGRAM_WEBHOOK_SECRET missing in production');
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
  const botUsername = getBotUsername().toLowerCase();

  // 1. Inline Keyboard Callbacks
  if (callbackQuery?.data) {
    const cbData: string = String(callbackQuery.data);
    const cbId: string | undefined = callbackQuery.id ? String(callbackQuery.id) : undefined;
    const fromId: number | undefined = typeof callbackQuery.from?.id === 'number' ? callbackQuery.from.id : undefined;
    const fromName: string = callbackQuery.from?.first_name || 'کاربر مدار';
    const db = getDb();

    // Forced channel re-check button
    if (cbData === 'madar_check_channels' && fromId) {
      const chatId = callbackQuery.message?.chat?.id ?? fromId;
      upsertTelegramUser({
        id: fromId,
        first_name: fromName,
        last_name: callbackQuery.from?.last_name,
        username: callbackQuery.from?.username,
        language_code: callbackQuery.from?.language_code,
      });

      const membership = await verifyForcedChannelMembership(fromId);
      if (!membership.allJoined) {
        if (cbId) {
          await answerCallback(cbId, 'هنوز عضو همه کانال‌ها نشده‌اید.', true);
        }
        return NextResponse.json({ ok: true, handled: 'check_channels', allJoined: false });
      }

      if (cbId) {
        await answerCallback(cbId, 'عضویت شما تأیید شد.');
      }
      const res = await advancePrivateOnboarding(chatId, fromId, fromName, appUrl);
      return NextResponse.json({ ok: true, handled: 'check_channels', allJoined: true, nextStep: res.step });
    }

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
            await sendTelegramMessage(callbackQuery.message.chat.id, `رأی ${fromName} برای «${target.name}» ثبت شد.`);
          }
        }
      }
      if (cbId) await answerCallback(cbId, 'رأی ثبت شد.');
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
      if (cbId) await answerCallback(cbId);
      return NextResponse.json({ ok: true, handled: 'mafia_dm' });
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
    const isForwarded = Boolean(
      message.forward_origin ||
        message.forward_from ||
        message.forward_from_chat ||
        message.forward_sender_name ||
        message.forward_date
    );

    // 2A. PRIVATE CHAT: Strict Verified Telegram Contact Handler
    if (message.contact) {
      if (chatType !== 'private') {
        return NextResponse.json({ ok: true, rejected: 'contact_not_private_chat' });
      }
      if (!fromId || typeof message.contact.user_id !== 'number') {
        await sendTelegramMessage(chatId, 'اطلاعات تماس معتبر نیست. فقط شماره متعلق به حساب خودتان پذیرفته می‌شود.');
        return NextResponse.json({ ok: true, rejected: 'missing_contact_user_id' });
      }
      if (isForwarded) {
        await sendTelegramMessage(chatId, 'ارسال شماره فورواردشده مجاز نیست. لطفاً فقط از دکمه رسمی «اشتراک‌گذاری شماره» استفاده کنید.');
        return NextResponse.json({ ok: true, rejected: 'forwarded_contact' });
      }
      if (message.contact.user_id !== fromId) {
        await sendTelegramMessage(chatId, 'فقط می‌توانید شماره متعلق به حساب تلگرام خودتان را به اشتراک بگذارید.');
        return NextResponse.json({ ok: true, rejected: 'contact_user_mismatch' });
      }

      const normalizedPhone = normalizeTelegramPhone(String(message.contact.phone_number || ''));
      if (!normalizedPhone) {
        await sendTelegramMessage(chatId, 'قالب شماره دریافتی معتبر نبود. لطفاً دوباره از طریق دکمه «اشتراک‌گذاری شماره» اقدام کنید.');
        return NextResponse.json({ ok: true, rejected: 'invalid_phone_format' });
      }

      // Ensure user record exists without overwriting MADAR profile data
      const upserted = upsertTelegramUser({
        id: fromId,
        first_name: fromName,
        last_name: message.from?.last_name,
        username: message.from?.username,
        language_code: message.from?.language_code,
      });

      if (upserted.isBanned) {
        return NextResponse.json({ ok: true, rejected: 'user_banned' });
      }

      const db = getDb();
      const current = db
        .prepare('SELECT phone_verified FROM users WHERE id = ?')
        .get(upserted.userId) as { phone_verified: number } | undefined;

      // Save phone only once unless a future explicit change process is used
      if (!current?.phone_verified) {
        // Check channel membership first before completing onboarding
        const membership = await verifyForcedChannelMembership(fromId);
        if (!membership.allJoined) {
          await sendTelegramMessage(
            chatId,
            'ابتدا عضو کانال‌های زیر شوید و سپس روی «بررسی عضویت» بزنید.',
            buildForcedChannelsKeyboard(membership.channels)
          );
          return NextResponse.json({ ok: true, rejected: 'channels_not_joined' });
        }

        db.prepare(`
          UPDATE users
          SET phone = ?,
              phone_verified = 1,
              phone_shared_at = datetime('now'),
              channel_verified_at = COALESCE(channel_verified_at, datetime('now')),
              onboarding_completed = 1
          WHERE id = ?
        `).run(normalizedPhone, upserted.userId);
      }

      await sendTelegramMessage(chatId, 'شماره با موفقیت ثبت شد.', buildEnterMadarKeyboard(appUrl));
      return NextResponse.json({ ok: true, handled: 'verified_contact', userId: upserted.userId });
    }

    // 2B. PRIVATE CHAT: /start Flow
    if (chatType === 'private' && text.startsWith('/start') && fromId) {
      const payload = text.split(' ')[1] || '';
      const referralCode = payload.startsWith('ref_') ? payload : undefined;

      const upserted = upsertTelegramUser(
        {
          id: fromId,
          first_name: fromName,
          last_name: message.from?.last_name,
          username: message.from?.username,
          language_code: message.from?.language_code,
        },
        { referralCode }
      );

      if (upserted.isBanned) {
        await sendTelegramMessage(chatId, 'دسترسی این حساب به مدار محدود شده است.');
        return NextResponse.json({ ok: true, handled: 'start_banned' });
      }

      let extraNote = '';
      if (payload.startsWith('ref_')) {
        extraNote = '\nدعوت شما ثبت شد.';
      } else if (payload.startsWith('anon_')) {
        extraNote = '\nبرای ارسال نجوای ناشناس وارد مدار شوید.';
      } else if (payload.startsWith('room_')) {
        extraNote = `\nاتاق بازی ${payload.slice(5)} آماده است.`;
      }

      const res = await advancePrivateOnboarding(chatId, fromId, fromName, appUrl, extraNote);
      return NextResponse.json({ ok: true, handled: 'start', step: res.step });
    }

    // 2C. PRIVATE CHAT: Reject manually typed phone numbers
    if (chatType === 'private' && fromId && text && !text.startsWith('/')) {
      const looksLikePhone = /^\+?[0-9۰-۹\s\-()]{8,18}$/.test(text);
      if (looksLikePhone) {
        const db = getDb();
        const u = db.prepare('SELECT phone_verified FROM users WHERE telegram_id = ?').get(String(fromId)) as
          | { phone_verified: number }
          | undefined;
        if (!u?.phone_verified) {
          await sendTelegramMessage(
            chatId,
            'واردکردن دستی شماره مجاز نیست. لطفاً فقط از دکمه رسمی «اشتراک‌گذاری شماره» استفاده کنید.',
            buildContactStepKeyboard(appUrl)
          );
          return NextResponse.json({ ok: true, rejected: 'manual_phone_text' });
        }
      }
    }

    // 2D. GROUP / SUPERGROUP: Local Moderation Engine & /mafia
    if (chatType === 'group' || chatType === 'supergroup') {
      const db = getDb();

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
        const entities = Array.isArray(message.entities) ? message.entities : [];
        const mentionCount = entities.filter(
          (e: { type?: string }) => e?.type === 'mention' || e?.type === 'text_mention'
        ).length;

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
