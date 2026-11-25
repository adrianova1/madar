import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { getAuthUser } from '@/lib/security';
import { MAFIA_ROLE_META, MafiaRole } from '@/lib/mafia-engine';

interface RoomPlayer {
  id: string;
  userId?: number;
  name: string;
  role: MafiaRole;
  alive: boolean;
}

interface ChannelEvent {
  channel: 'telegram_group' | 'bot_dm' | 'mini_app';
  text: string;
  at: string;
}

const RoomActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    gameType: z.enum(['mafia', 'hokm', 'quiz', 'truth_dare']).default('mafia'),
    playerNames: z.array(z.string().min(1).max(32)).min(6).max(12),
    groupTitle: z.string().max(60).optional(),
  }),
  z.object({
    action: z.literal('cast_vote'),
    roomCode: z.string().min(4).max(20),
    voterId: z.string().min(1).max(20),
    targetId: z.string().min(1).max(20),
    channel: z.enum(['telegram_group', 'mini_app']).default('telegram_group'),
  }),
  z.object({
    action: z.literal('request_dm_role'),
    roomCode: z.string().min(4).max(20),
    playerId: z.string().min(1).max(20),
  }),
  z.object({
    action: z.literal('resolve_votes'),
    roomCode: z.string().min(4).max(20),
  }),
]);

function sanitizePublicRoom(row: Record<string, unknown>, viewerUserId: number) {
  const players = JSON.parse(String(row.players_json || '[]')) as RoomPlayer[];
  const votes = JSON.parse(String(row.votes_json || '{}')) as Record<string, string>;
  const channelLog = JSON.parse(String(row.channel_log_json || '[]')) as ChannelEvent[];

  // SECURITY: Never expose secret roles in public room state!
  return {
    roomCode: String(row.room_code),
    gameType: String(row.game_type),
    phase: String(row.phase),
    dayNumber: Number(row.day_number),
    status: String(row.status),
    groupChatId: String(row.group_chat_id || ''),
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      isCurrentUser: p.userId === viewerUserId,
    })),
    votes,
    channelLog,
    updatedAt: String(row.updated_at),
  };
}

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'برای مشاهده اتاق همگام تلگرام ابتدا وارد حساب شوید.' }, { status: 401 });
  }

  const db = getDb();
  const roomCode = req.nextUrl.searchParams.get('roomCode')?.trim().toUpperCase();

  if (roomCode) {
    const row = db.prepare('SELECT * FROM game_rooms WHERE room_code = ?').get(roomCode) as
      | Record<string, unknown>
      | undefined;
    if (!row) return NextResponse.json({ error: 'اتاق بازی با این کد یافت نشد.' }, { status: 404 });
    const players = JSON.parse(String(row.players_json || '[]')) as RoomPlayer[];
    const isAuthorized =
      Number(row.host_user_id) === auth.id || players.some((p) => p.userId === auth.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'دسترسی به این اتاق همگام برای شما مجاز نیست.' }, { status: 403 });
    }
    return NextResponse.json({ room: sanitizePublicRoom(row, auth.id) });
  }

  const recent = db
    .prepare("SELECT * FROM game_rooms WHERE host_user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 6")
    .all(auth.id) as Record<string, unknown>[];
  return NextResponse.json({ rooms: recent.map((r) => sanitizePublicRoom(r, auth.id)) });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'برای ساخت یا تعامل با اتاق همگام، وارد حساب شوید.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = RoomActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'اطلاعات اتاق نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();
  const d = parsed.data;
  const nowStr = new Date().toISOString().slice(11, 19);

  if (d.action === 'create') {
    const count = d.playerNames.length;
    const roles: MafiaRole[] = [];
    const mafiaCount = count >= 9 ? 3 : 2;
    for (let i = 0; i < mafiaCount; i++) roles.push('mafia');
    roles.push('doctor', 'detective');
    if (count >= 7) roles.push('sniper');
    while (roles.length < count) roles.push('citizen');

    for (let i = roles.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    const players: RoomPlayer[] = d.playerNames.map((name, idx) => ({
      id: `p_${idx + 1}`,
      userId: idx === 0 ? auth.id : undefined,
      name: name.trim(),
      role: roles[idx],
      alive: true,
    }));

    const roomCode = `MDR-${crypto.randomInt(1000, 9999)}`;
    const initialLog: ChannelEvent[] = [
      {
        channel: 'mini_app',
        text: `اتاق همگام ${roomCode} با ${players.length} بازیکن ساخته شد.`,
        at: nowStr,
      },
      {
        channel: 'telegram_group',
        text: `رأی‌گیری همگام برای گروه «${d.groupTitle || 'گروه تلگرام'}» آماده شد.`,
        at: nowStr,
      },
      {
        channel: 'bot_dm',
        text: 'نقش مخفی هر بازیکن فقط به‌صورت خصوصی نمایش داده می‌شود.',
        at: nowStr,
      },
    ];

    db.prepare(`
      INSERT INTO game_rooms (room_code, game_type, host_user_id, group_chat_id, phase, day_number, players_json, votes_json, channel_log_json)
      VALUES (?, ?, ?, ?, 'VOTING', 1, ?, '{}', ?)
    `).run(roomCode, d.gameType, auth.id, d.groupTitle || 'گروه تلگرام', JSON.stringify(players), JSON.stringify(initialLog));

    const row = db.prepare('SELECT * FROM game_rooms WHERE room_code = ?').get(roomCode) as Record<string, unknown>;
    return NextResponse.json({ ok: true, room: sanitizePublicRoom(row, auth.id) }, { status: 201 });
  }

  const row = db.prepare('SELECT * FROM game_rooms WHERE room_code = ?').get(d.roomCode.toUpperCase()) as
    | Record<string, unknown>
    | undefined;
  if (!row) return NextResponse.json({ error: 'اتاق موردنظر یافت نشد.' }, { status: 404 });

  const isHost = Number(row.host_user_id) === auth.id;
  const players = JSON.parse(String(row.players_json || '[]')) as RoomPlayer[];
  const isParticipant = isHost || players.some((p) => p.userId === auth.id);
  if (!isParticipant) {
    return NextResponse.json({ error: 'شما عضو یا میزبان این اتاق همگام نیستید.' }, { status: 403 });
  }

  const votes = JSON.parse(String(row.votes_json || '{}')) as Record<string, string>;
  const channelLog = JSON.parse(String(row.channel_log_json || '[]')) as ChannelEvent[];

  if (d.action === 'request_dm_role') {
    const seat = players.find((p) => p.id === d.playerId);
    if (!seat) return NextResponse.json({ error: 'بازیکن یافت نشد.' }, { status: 404 });
    // Strict role authorization: owned seat can only be viewed by its owner; unowned seat only by the room host
    const canViewSeat = seat.userId ? seat.userId === auth.id : isHost;
    if (!canViewSeat) {
      return NextResponse.json({ error: 'دسترسی به نقش مخفی بازیکن دیگر مجاز نیست.' }, { status: 403 });
    }
    const meta = MAFIA_ROLE_META[seat.role];
    const nextLog: ChannelEvent[] = [
      { channel: 'bot_dm', text: `نقش محرمانه به پی‌وی ${seat.name} تحویل داده شد.`, at: nowStr },
      ...channelLog.slice(0, 14),
    ];
    db.prepare("UPDATE game_rooms SET channel_log_json = ?, updated_at = datetime('now') WHERE room_code = ?").run(
      JSON.stringify(nextLog),
      d.roomCode.toUpperCase()
    );
    return NextResponse.json({
      ok: true,
      privateDmPayload: {
        playerName: seat.name,
        roleKey: seat.role,
        roleTitle: meta.fa,
        team: meta.team === 'mafia' ? 'تیم مافیا' : 'تیم شهروند',
        description: meta.description,
      },
    });
  }

  if (d.action === 'cast_vote') {
    const voter = players.find((p) => p.id === d.voterId && p.alive);
    const target = players.find((p) => p.id === d.targetId && p.alive);
    if (!voter || !target) {
      return NextResponse.json({ error: 'رأی‌دهنده یا هدف انتخابی در بازی زنده نیست.' }, { status: 400 });
    }
    if (!isHost && voter.userId !== auth.id) {
      return NextResponse.json({ error: 'فقط می‌توانید به‌نام خودتان یا به‌عنوان میزبان رأی ثبت کنید.' }, { status: 403 });
    }
    votes[voter.id] = target.id;
    const nextLog: ChannelEvent[] = [
      {
        channel: d.channel,
        text: `${voter.name} از طریق ${d.channel === 'telegram_group' ? 'گروه تلگرام' : 'مینی‌اپ'} به «${target.name}» رأی داد.`,
        at: nowStr,
      },
      ...channelLog.slice(0, 14),
    ];
    db.prepare("UPDATE game_rooms SET votes_json = ?, channel_log_json = ?, updated_at = datetime('now') WHERE room_code = ?").run(
      JSON.stringify(votes),
      JSON.stringify(nextLog),
      d.roomCode.toUpperCase()
    );
    const updated = db.prepare('SELECT * FROM game_rooms WHERE room_code = ?').get(d.roomCode.toUpperCase()) as Record<string, unknown>;
    return NextResponse.json({ ok: true, room: sanitizePublicRoom(updated, auth.id) });
  }

  if (d.action === 'resolve_votes') {
    if (!isHost) {
      return NextResponse.json({ error: 'فقط میزبان اتاق می‌تواند رأی‌گیری را ببندد.' }, { status: 403 });
    }
    const tally = new Map<string, number>();
    for (const targetId of Object.values(votes)) {
      tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
    }
    let topId: string | null = null;
    let topCount = 0;
    for (const [tid, count] of tally.entries()) {
      if (count > topCount) {
        topId = tid;
        topCount = count;
      }
    }

    let summary = 'در این دور رأیی ثبت نشد.';
    if (topId) {
      const victim = players.find((p) => p.id === topId);
      if (victim) {
        victim.alive = false;
        summary = `با ${topCount} رأی همگام، «${victim.name}» از شهر خارج شد.`;
      }
    }

    const nextDay = Number(row.day_number) + 1;
    const nextLog: ChannelEvent[] = [
      { channel: 'mini_app', text: summary, at: nowStr },
      ...channelLog.slice(0, 14),
    ];
    db.prepare(
      "UPDATE game_rooms SET day_number = ?, players_json = ?, votes_json = '{}', channel_log_json = ?, updated_at = datetime('now') WHERE room_code = ?"
    ).run(nextDay, JSON.stringify(players), JSON.stringify(nextLog), d.roomCode.toUpperCase());

    const updated = db.prepare('SELECT * FROM game_rooms WHERE room_code = ?').get(d.roomCode.toUpperCase()) as Record<string, unknown>;
    return NextResponse.json({ ok: true, room: sanitizePublicRoom(updated, auth.id), message: summary });
  }

  return NextResponse.json({ error: 'عملیات نامعتبر' }, { status: 400 });
}
