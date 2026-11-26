import { NextRequest, NextResponse } from 'next/server';
import { callTelegramBot } from '@/lib/telegram-bot';

/**
 * Proxies a Telegram profile photo by file_id without ever exposing TELEGRAM_BOT_TOKEN to the browser.
 */
export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get('fileId')?.trim();
  if (!fileId || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) {
    return new NextResponse(null, { status: 400 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return new NextResponse(null, { status: 404 });

  const fileRes = await callTelegramBot<{ file_path?: string }>('getFile', { file_id: fileId });
  const filePath = fileRes.result?.file_path;
  if (!fileRes.ok || !filePath || filePath.includes('..')) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const imgRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!imgRes.ok) return new NextResponse(null, { status: 404 });
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return new NextResponse(null, { status: 400 });
    const buf = await imgRes.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
