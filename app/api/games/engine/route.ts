import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getAuthUser } from '@/lib/security';
import {
  assertRoomMember,
  cleanupExpiredEngineRooms,
  createEngineRoom,
  GameEngineError,
  handleHokmChooseTrump,
  handleHokmNextHand,
  handleHokmPlayCard,
  handleMafiaNightAction,
  handleMafiaStartVote,
  handleMafiaVote,
  handleQuizAnswer,
  handleQuizNext,
  handleSwitchHangoutGame,
  handleTruthDareChooseMode,
  handleTruthDareResolveTurn,
  handleTruthDareSpin,
  loadEngineRoom,
  sanitizeEngineStateForUser,
  saveEngineRoom,
} from '@/lib/game-engine';

const EngineActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_room'),
    gameType: z.enum(['hokm', 'mafia', 'quiz', 'truth_dare']),
    isHangout: z.boolean().optional(),
    playerNames: z.array(z.string().min(1).max(28)).max(10).optional(),
    category: z.string().max(40).optional(),
    mafiaScenario: z.enum(['classic', 'tactical']).optional(),
    hokmTargetHands: z.number().int().min(1).max(7).optional(),
  }),
  z.object({
    action: z.literal('join_room'),
    roomCode: z.string().min(4).max(20),
  }),
  z.object({
    action: z.literal('switch_game'),
    roomCode: z.string().min(4).max(20),
    nextGame: z.enum(['hokm', 'mafia', 'quiz', 'truth_dare']),
    category: z.string().max(40).optional(),
  }),
  z.object({
    action: z.literal('hokm_choose_trump'),
    roomCode: z.string().min(4).max(20),
    suit: z.enum(['spades', 'hearts', 'diamonds', 'clubs']),
  }),
  z.object({
    action: z.literal('hokm_play_card'),
    roomCode: z.string().min(4).max(20),
    cardId: z.string().min(3).max(24),
  }),
  z.object({
    action: z.literal('hokm_next_hand'),
    roomCode: z.string().min(4).max(20),
  }),
  z.object({
    action: z.literal('mafia_night_action'),
    roomCode: z.string().min(4).max(20),
    targetId: z.string().max(30).optional(),
  }),
  z.object({
    action: z.literal('mafia_start_vote'),
    roomCode: z.string().min(4).max(20),
  }),
  z.object({
    action: z.literal('mafia_vote'),
    roomCode: z.string().min(4).max(20),
    targetId: z.string().min(1).max(30),
  }),
  z.object({
    action: z.literal('td_spin'),
    roomCode: z.string().min(4).max(20),
    category: z.string().max(40).optional(),
  }),
  z.object({
    action: z.literal('td_choose_mode'),
    roomCode: z.string().min(4).max(20),
    mode: z.enum(['truth', 'dare']),
    category: z.string().max(40).optional(),
  }),
  z.object({
    action: z.literal('td_resolve'),
    roomCode: z.string().min(4).max(20),
    outcome: z.enum(['completed', 'skipped']),
  }),
  z.object({
    action: z.literal('td_react'),
    roomCode: z.string().min(4).max(20),
    emoji: z.string().min(1).max(8),
  }),
  z.object({
    action: z.literal('quiz_answer'),
    roomCode: z.string().min(4).max(20),
    selectedIndex: z.number().int().min(-1).max(3),
  }),
  z.object({
    action: z.literal('quiz_next'),
    roomCode: z.string().min(4).max(20),
  }),
  z.object({
    action: z.literal('leave_room'),
    roomCode: z.string().min(4).max(20),
  }),
]);

export async function GET(req: NextRequest) {
  cleanupExpiredEngineRooms();
  const auth = getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'برای مشاهده وضعیت اتاق بازی ابتدا وارد حساب تلگرام خود شوید.' }, { status: 401 });
  }

  const roomCode = req.nextUrl.searchParams.get('roomCode')?.trim().toUpperCase();

  if (roomCode) {
    const state = loadEngineRoom(roomCode);
    if (!state) {
      return NextResponse.json({ error: 'اتاق بازی یافت نشد یا منقضی شده است.' }, { status: 404 });
    }
    const isMember = state.players.some((p) => p.userId === auth.id && p.status !== 'left');
    if (!isMember) {
      return NextResponse.json(
        { error: 'شما عضو این اتاق بازی نیستید. ابتدا با کد اتاق به آن بپیوندید.' },
        { status: 403 }
      );
    }
    return NextResponse.json({
      room: sanitizeEngineStateForUser(state, auth.id),
    });
  }

  const db = getDb();
  const activeRows = db
    .prepare(
      "SELECT room_code, game_type, is_hangout, status, updated_at FROM engine_rooms WHERE host_user_id = ? AND status != 'finished' ORDER BY id DESC LIMIT 10"
    )
    .all(auth.id);

  return NextResponse.json({
    activeRooms: activeRows,
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'برای شروع و ثبت بازی‌ها ابتدا وارد حساب مدار شوید.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = EngineActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'درخواست موتور بازی نامعتبر است.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const db = getDb();

  try {
    if (d.action === 'create_room') {
      const prof = db
        .prepare('SELECT avatar_initials, avatar_color FROM user_profiles WHERE user_id = ?')
        .get(auth.id) as { avatar_initials: string; avatar_color: string } | undefined;

      const state = createEngineRoom({
        hostUserId: auth.id,
        hostDisplayName: auth.display_name,
        hostInitials: prof?.avatar_initials || auth.display_name.slice(0, 2),
        hostColor: prof?.avatar_color || '#38bdf8',
        gameType: d.gameType,
        isHangout: d.isHangout,
        playerNames: d.playerNames,
        category: d.category,
        mafiaScenario: d.mafiaScenario,
        hokmTargetHands: d.hokmTargetHands,
      });

      return NextResponse.json(
        { ok: true, room: sanitizeEngineStateForUser(state, auth.id) },
        { status: 201 }
      );
    }

    const state = loadEngineRoom(d.roomCode);
    if (!state) {
      return NextResponse.json({ error: 'اتاق بازی یافت نشد یا منقضی شده است.' }, { status: 404 });
    }

    if (d.action === 'join_room') {
      const already = state.players.find((p) => p.userId === auth.id);
      if (already) {
        already.status = 'playing';
        saveEngineRoom(state, 'playing');
      } else {
        const prof = db
          .prepare('SELECT avatar_initials, avatar_color FROM user_profiles WHERE user_id = ?')
          .get(auth.id) as { avatar_initials: string; avatar_color: string } | undefined;

        const botSlot = state.players.find((p) => p.isBot);
        if (botSlot) {
          botSlot.userId = auth.id;
          botSlot.name = auth.display_name;
          botSlot.avatarInitials = prof?.avatar_initials || auth.display_name.slice(0, 2);
          botSlot.avatarColor = prof?.avatar_color || '#8b5cf6';
          botSlot.isBot = false;
          botSlot.status = 'playing';
        } else if (state.players.length < 10) {
          state.players.push({
            id: `u_${auth.id}`,
            userId: auth.id,
            name: auth.display_name,
            avatarInitials: prof?.avatar_initials || auth.display_name.slice(0, 2),
            avatarColor: prof?.avatar_color || '#8b5cf6',
            isBot: false,
            score: 0,
            status: 'playing',
          });
        } else {
          return NextResponse.json({ error: 'ظرفیت این اتاق تکمیل شده است.' }, { status: 400 });
        }
        saveEngineRoom(state, 'playing');
      }
      return NextResponse.json({ ok: true, room: sanitizeEngineStateForUser(state, auth.id) });
    }

    // Strict membership check for ALL room actions beyond create_room / join_room
    assertRoomMember(state, auth.id);

    if (d.action === 'switch_game') {
      const next = handleSwitchHangoutGame(state, auth.id, d.nextGame, d.category);
      return NextResponse.json({ ok: true, room: sanitizeEngineStateForUser(next, auth.id) });
    }

    if (d.action === 'hokm_choose_trump') {
      const next = handleHokmChooseTrump(state, auth.id, d.suit);
      return NextResponse.json({ ok: true, room: sanitizeEngineStateForUser(next, auth.id) });
    }

    if (d.action === 'hokm_play_card') {
      const { state: next, starsAwarded } = handleHokmPlayCard(state, auth.id, d.cardId);
      return NextResponse.json({
        ok: true,
        room: sanitizeEngineStateForUser(next, auth.id),
        starsAwarded,
        message: starsAwarded ? `مسابقه پایان یافت و +${starsAwarded} ستاره دریافت کردی!` : undefined,
      });
    }

    if (d.action === 'hokm_next_hand') {
      const next = handleHokmNextHand(state, auth.id);
      return NextResponse.json({ ok: true, room: sanitizeEngineStateForUser(next, auth.id) });
    }

    if (d.action === 'mafia_night_action') {
      const { state: next, starsAwarded } = handleMafiaNightAction(state, auth.id, d.targetId);
      return NextResponse.json({
        ok: true,
        room: sanitizeEngineStateForUser(next, auth.id),
        starsAwarded,
        message: starsAwarded ? `بازی مافیا پایان یافت و +${starsAwarded} ستاره دریافت کردی!` : undefined,
      });
    }

    if (d.action === 'mafia_start_vote') {
      const next = handleMafiaStartVote(state, auth.id);
      return NextResponse.json({ ok: true, room: sanitizeEngineStateForUser(next, auth.id) });
    }

    if (d.action === 'mafia_vote') {
      const { state: next, starsAwarded } = handleMafiaVote(state, auth.id, d.targetId);
      return NextResponse.json({
        ok: true,
        room: sanitizeEngineStateForUser(next, auth.id),
        starsAwarded,
        message: starsAwarded ? `بازی مافیا پایان یافت و +${starsAwarded} ستاره دریافت کردی!` : undefined,
      });
    }

    if (d.action === 'td_spin') {
      const next = handleTruthDareSpin(state, auth.id, d.category);
      return NextResponse.json({ ok: true, room: sanitizeEngineStateForUser(next, auth.id) });
    }

    if (d.action === 'td_choose_mode') {
      const next = handleTruthDareChooseMode(state, auth.id, d.mode, d.category);
      return NextResponse.json({ ok: true, room: sanitizeEngineStateForUser(next, auth.id) });
    }

    if (d.action === 'td_resolve') {
      const { state: next, starsAwarded } = handleTruthDareResolveTurn(state, auth.id, d.outcome);
      return NextResponse.json({
        ok: true,
        room: sanitizeEngineStateForUser(next, auth.id),
        starsAwarded,
        message: starsAwarded ? `+${starsAwarded} ستاره پاداش دریافت کردی!` : undefined,
      });
    }

    if (d.action === 'td_react') {
      if (state.truthDare) {
        state.truthDare.reactions = [
          { id: `${Date.now()}`, emoji: d.emoji, from: auth.display_name },
          ...state.truthDare.reactions.slice(0, 5),
        ];
        saveEngineRoom(state, 'playing');
      }
      return NextResponse.json({ ok: true, room: sanitizeEngineStateForUser(state, auth.id) });
    }

    if (d.action === 'quiz_answer') {
      const { state: next } = handleQuizAnswer(state, auth.id, d.selectedIndex);
      return NextResponse.json({ ok: true, room: sanitizeEngineStateForUser(next, auth.id) });
    }

    if (d.action === 'quiz_next') {
      const { state: next, starsAwarded } = handleQuizNext(state, auth.id);
      return NextResponse.json({
        ok: true,
        room: sanitizeEngineStateForUser(next, auth.id),
        starsAwarded,
        message: starsAwarded ? `کوییز پایان یافت و +${starsAwarded} ستاره دریافت کردی!` : undefined,
      });
    }

    if (d.action === 'leave_room') {
      state.players = state.players.map((p) => (p.userId === auth.id ? { ...p, status: 'left' } : p));
      const anyHumansLeft = state.players.some((p) => !p.isBot && p.status !== 'left');
      saveEngineRoom(state, anyHumansLeft ? 'playing' : 'finished');
      return NextResponse.json({ ok: true, message: 'از اتاق بازی خارج شدید.' });
    }

    return NextResponse.json({ error: 'عملیات ناشناخته است.' }, { status: 400 });
  } catch (err) {
    if (err instanceof GameEngineError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'خطا در پردازش موتور بازی' },
      { status: 400 }
    );
  }
}
