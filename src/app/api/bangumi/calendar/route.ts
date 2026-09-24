import { NextResponse } from 'next/server';

import type { BangumiCalendarData } from '@/lib/bangumi.client';
import { BANGUMI_USER_AGENT } from '@/lib/bangumi-aliases';
import {
  BANGUMI_OFFICIAL_ORIGIN,
  fetchBangumiJson,
} from '@/lib/bangumi-upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 6 * 60 * 60 * 1000;
// api.bgm.tv 回應大小不在我方控制內；與豆瓣路徑同樣設 5MB 上限。
const MAX_CALENDAR_RESPONSE_BYTES = 5 * 1024 * 1024;
let calendarCache: {
  expiresAt: number;
  data: BangumiCalendarData[];
} | null = null;

export async function GET() {
  const now = Date.now();
  if (calendarCache && calendarCache.expiresAt > now) {
    return createCalendarResponse(calendarCache.data);
  }

  const result = await fetchBangumiJson<BangumiCalendarData[]>('calendar', {
    timeoutMs: 8000,
    maxBytes: MAX_CALENDAR_RESPONSE_BYTES,
    headersFor: (origin) => ({
      Accept: 'application/json',
      'User-Agent': BANGUMI_USER_AGENT,
      ...(origin === BANGUMI_OFFICIAL_ORIGIN ? getBangumiAuthHeaders() : {}),
    }),
    parse: (value) =>
      Array.isArray(value) ? (value as BangumiCalendarData[]) : null,
  });
  if (result.status !== 'ok') {
    return createCalendarResponse(calendarCache?.data || []);
  }

  try {
    const filteredData = result.data.map((item) => ({
      ...item,
      items: Array.isArray(item.items)
        ? item.items.filter((bangumiItem) => bangumiItem.images)
        : [],
    }));

    calendarCache = {
      expiresAt: now + CACHE_TTL,
      data: filteredData,
    };

    return createCalendarResponse(filteredData);
  } catch {
    return createCalendarResponse(calendarCache?.data || []);
  }
}

function createCalendarResponse(data: BangumiCalendarData[]) {
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=21600, s-maxage=21600',
    },
  });
}

function getBangumiAuthHeaders(): Record<string, string> {
  const token = process.env.BANGUMI_ACCESS_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
