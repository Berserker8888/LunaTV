import { NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/api-rate-limit';
import { setBoundedMapValue } from '@/lib/bounded-map';
import { isAliasWorthRetrying, pickPrimaryAlias } from '@/lib/douban-alias';
import { getTmdbApiKey, isTmdbConfigured } from '@/lib/tmdb';
import {
  applyTmdbAuth,
  buildTmdbAlternativeTitlesUrl,
  buildTmdbSearchUrl,
  buildTmdbTranslationsUrl,
  extractTmdbTitleAliases,
  hasTmdbSearchHits,
  pickTmdbCandidateIds,
  type TmdbAlternativeTitlesResponse,
  type TmdbSearchResponse,
  type TmdbTranslationsResponse,
} from '@/lib/tmdb-alias';
import {
  fetchSafeRemoteUrl,
  readResponseJsonWithLimit,
} from '@/lib/url-safety';

export const runtime = 'nodejs';

/**
 * 台灣片名 → 大陸片名 的第二別名解析端點（TMDB）。
 *
 * 豆瓣反查是第一順位；豆瓣被限流或查無結果時，前端改打這一端：
 * TMDB 搜尋取作品 ID → alternative_titles 取 CN／TW／HK 譯名，
 * 另取 translations 的官方中文在地化（動漫的簡體中文名經常只在這裡有）。
 * 只在搜尋完全沒有結果時由前端呼叫，請求量極低；快取放伺服器端共用。
 */

const ALIAS_CACHE = new Map<
  string,
  { expiresAt: number; aliases: string[]; primary: string | null }
>();
const ALIAS_CACHE_TTL = 24 * 60 * 60 * 1000; // 片名對照極少變動
const NEGATIVE_CACHE_TTL = 10 * 60 * 1000; // 查無結果時短暫記住，避免反覆重試
const MAX_ALIAS_CACHE_ENTRIES = 500;
const MAX_QUERY_LENGTH = 60;
const FETCH_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 512 * 1024;

function jsonResponse(aliases: string[], primary: string | null) {
  return NextResponse.json(
    { aliases, primary },
    { headers: { 'Cache-Control': 'private, max-age=3600' } }
  );
}

async function fetchTmdbJson(
  url: string,
  apiKey: string,
  signal: AbortSignal
): Promise<unknown> {
  const authed = applyTmdbAuth(url, apiKey);
  const response = await fetchSafeRemoteUrl(authed.url, {
    headers: authed.headers,
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`TMDB ${response.status}`);
  }
  return readResponseJsonWithLimit(response, MAX_RESPONSE_BYTES);
}

export async function GET(request: Request) {
  // 只在搜尋完全沒結果、且豆瓣別名也查無時才會被呼叫，使用量極低。
  const limited = await enforceRateLimit(request, {
    namespace: 'tmdb-alias',
    limit: 30,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const rawQuery = (searchParams.get('q') || '').trim();

  if (!rawQuery || rawQuery.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: '查詢參數無效', aliases: [], primary: null },
      { status: 400 }
    );
  }

  // 未設定 TMDB_API_KEY 的部署直接降級，不報錯
  if (!isTmdbConfigured()) {
    return jsonResponse([], null);
  }
  const apiKey = getTmdbApiKey();

  const cacheKey = `tmdb-alias:${rawQuery}`;
  const cached = ALIAS_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return jsonResponse(cached.aliases, cached.primary);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * 2);

  try {
    // movie＋tv 搜尋並行
    const [moviePayload, tvPayload] = (await Promise.all([
      fetchTmdbJson(
        buildTmdbSearchUrl('movie', rawQuery),
        apiKey,
        controller.signal
      ),
      fetchTmdbJson(
        buildTmdbSearchUrl('tv', rawQuery),
        apiKey,
        controller.signal
      ),
    ])) as [TmdbSearchResponse, TmdbSearchResponse];

    const candidates = pickTmdbCandidateIds(moviePayload, tvPayload);
    if (candidates.length === 0) {
      return jsonResponse([], null);
    }

    // 各候選作品的 alternative_titles＋translations 並行。
    // translations 必抓：動漫的簡體中文名經常只出現在官方在地化，
    // 不在 alternative_titles（上映別名）裡。
    const perCandidate = await Promise.all(
      candidates.map(async ({ mediaType, tmdbId }) => {
        const [alt, trans] = await Promise.all([
          fetchTmdbJson(
            buildTmdbAlternativeTitlesUrl(mediaType, tmdbId),
            apiKey,
            controller.signal
          ).catch(() => null),
          fetchTmdbJson(
            buildTmdbTranslationsUrl(mediaType, tmdbId),
            apiKey,
            controller.signal
          ).catch(() => null),
        ]);
        return { alt, trans };
      })
    );
    const altPayloads = perCandidate
      .map((p) => p.alt)
      .filter(Boolean) as TmdbAlternativeTitlesResponse[];
    const transPayloads = perCandidate
      .map((p) => p.trans)
      .filter(Boolean) as TmdbTranslationsResponse[];

    const aliases = extractTmdbTitleAliases(
      altPayloads,
      transPayloads,
      rawQuery
    ).filter((alias) => isAliasWorthRetrying(alias, rawQuery));
    const primary = pickPrimaryAlias(aliases);

    // 只有 TMDB 確實回傳了搜尋結果才寫入快取；被限流／查無此片時不快取空回應，
    // 避免冷卻期內一直拿到錯誤的「沒有別名」。
    if (hasTmdbSearchHits(moviePayload) || hasTmdbSearchHits(tvPayload)) {
      setBoundedMapValue(
        ALIAS_CACHE,
        cacheKey,
        {
          expiresAt:
            Date.now() +
            (aliases.length > 0 ? ALIAS_CACHE_TTL : NEGATIVE_CACHE_TTL),
          aliases,
          primary,
        },
        MAX_ALIAS_CACHE_ENTRIES
      );
    }

    return jsonResponse(aliases, primary);
  } catch {
    // 逾時／網路錯誤／JSON 損壞：一律降級為「沒有別名」
    return jsonResponse([], null);
  } finally {
    clearTimeout(timeoutId);
  }
}
