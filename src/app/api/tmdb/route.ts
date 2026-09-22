import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { isValidApiTextParam } from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { getConfig } from '@/lib/config';
import { positiveEpisodeCount } from '@/lib/episode-awareness';
import { lookupTmdb } from '@/lib/tmdb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TMDB_RATE_LIMIT = 30;
const TMDB_RATE_WINDOW_SECONDS = 60;

function readOptionalText(value: string | null): string | undefined {
  if (!value || !isValidApiTextParam(value)) return undefined;
  return value.trim();
}

/**
 * 播放頁補繁中資料。沒有 TMDB_API_KEY 或對不上時回 match: null，不擋播放。
 */
export async function GET(request: NextRequest) {
  const activeUser = await requireActiveUser(request);
  if (!activeUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = await enforceRateLimit(request, {
    namespace: 'api-tmdb',
    limit: TMDB_RATE_LIMIT,
    windowSeconds: TMDB_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const title = readOptionalText(searchParams.get('title'));
  if (!title) {
    return NextResponse.json({ error: '缺少片名' }, { status: 400 });
  }

  try {
    await getConfig();
  } catch {
    // 站點別名表讀不到時仍用內建台譯對照查 TMDB。
  }

  const episodes = positiveEpisodeCount(searchParams.get('episodes'));
  const match = await lookupTmdb({
    title,
    year: readOptionalText(searchParams.get('year')),
    typeName: readOptionalText(searchParams.get('type')),
    category: readOptionalText(searchParams.get('category')),
    episodes: episodes || undefined,
  });

  return NextResponse.json(
    { match },
    {
      status: 200,
      headers: { 'Cache-Control': 'private, max-age=300' },
    }
  );
}
