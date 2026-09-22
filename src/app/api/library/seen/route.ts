import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import {
  hasDisallowedUserOverride,
  parseAndValidateApiStorageKey,
  readJsonObject,
} from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { db } from '@/lib/db';
import { positiveEpisodeCount } from '@/lib/episode-awareness';
import { rejectCrossSiteRequest } from '@/lib/same-site';

export const runtime = 'nodejs';

const SEEN_RATE_LIMIT = 60;
const SEEN_RATE_WINDOW_SECONDS = 60;

/**
 * 播放頁載入到完整集數列表後呼叫。
 * 把 known_episodes 抬到這次看到的集數，首頁的「有新集」就會消掉。
 */
export async function POST(request: NextRequest) {
  try {
    const crossSite = rejectCrossSiteRequest(request);
    if (crossSite) return crossSite;

    const activeUser = await requireActiveUser(request);
    if (!activeUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limited = await enforceRateLimit(request, {
      namespace: 'library-seen',
      limit: SEEN_RATE_LIMIT,
      windowSeconds: SEEN_RATE_WINDOW_SECONDS,
    });
    if (limited) return limited;

    const body = await readJsonObject<{
      key?: string;
      total_episodes?: number;
    }>(request);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (hasDisallowedUserOverride(request, body)) {
      return NextResponse.json(
        { error: '不得指定其他使用者' },
        { status: 400 }
      );
    }

    const seen = positiveEpisodeCount(body.total_episodes);
    const parsedKey = parseAndValidateApiStorageKey(body.key || '');
    if (!parsedKey || !seen) {
      return NextResponse.json({ error: 'Invalid seen data' }, { status: 400 });
    }

    const result = await db.acknowledgeEpisodeCount(
      activeUser.username,
      parsedKey.source,
      parsedKey.id,
      seen
    );

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    console.error('標記已看集數失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
