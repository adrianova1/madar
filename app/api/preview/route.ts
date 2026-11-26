import { NextResponse } from 'next/server';
import {
  PREVIEW_MISSIONS,
  PREVIEW_NOTIFICATIONS,
  PREVIEW_PLANETS,
  PREVIEW_SESSIONS,
  PREVIEW_USER,
  PREVIEW_VENUS_CANDIDATES,
  PREVIEW_WHISPERS,
} from '@/lib/preview-data';

/**
 * Isolated Development Preview API.
 * Strictly disabled (HTTP 404) in production so anonymous users can NEVER access preview data.
 * Never reads from or writes to SQLite.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    preview: true,
    user: PREVIEW_USER,
    planets: PREVIEW_PLANETS,
    missions: PREVIEW_MISSIONS,
    notifications: PREVIEW_NOTIFICATIONS,
    sessions: PREVIEW_SESSIONS,
    venusCandidates: PREVIEW_VENUS_CANDIDATES,
    whispers: PREVIEW_WHISPERS,
  });
}
