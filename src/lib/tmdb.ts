import { setBoundedMapValue } from './bounded-map';
import { logger } from './logger';
import {
  chooseTraditionalText,
  collectTmdbSearchQueries,
  extractSeasonNumber,
  hasHanText,
  mapTmdbDetail,
  mapTmdbSearchResults,
  pickTmdbCandidate,
  type TmdbMatch,
  type TmdbMediaType,
  type TmdbQuery,
} from './tmdb-match';
import { fetchSafeRemoteUrl, readResponseJsonWithLimit } from './url-safety';

const TMDB_ORIGIN = 'https://api.themoviedb.org/3';
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 8_000;
const POSITIVE_TTL_MS = 12 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 300;

type CacheEntry = { expiresAt: number; match: TmdbMatch | null };
const responseCache = new Map<string, CacheEntry>();

export function getTmdbApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TMDB_API_KEY || '').trim();
}

export function isTmdbConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return getTmdbApiKey(env).length > 0;
}

/** 測試用。正式查詢的快取跟程序一起活。 */
export function __clearTmdbCache(): void {
  responseCache.clear();
}

export type TmdbJsonFetcher = (url: string, apiKey: string) => Promise<unknown>;

export interface TmdbLookupDeps {
  apiKey?: string;
  fetchJson?: TmdbJsonFetcher;
  now?: number;
}

function cacheKey(query: TmdbQuery): string {
  return [
    collectTmdbSearchQueries(query.title).join('||'),
    query.year || '',
    query.episodes || '',
    query.typeName || '',
    query.category || '',
    extractSeasonNumber(query.title) || '',
  ].join('|');
}

async function defaultFetchJson(url: string, apiKey: string): Promise<unknown> {
  const parsed = new URL(url);
  const headers: Record<string, string> = { Accept: 'application/json' };
  // v4 權杖是 JWT；v3 金鑰放在查詢參數。錯誤訊息只留狀態碼，避免把金鑰寫進日誌。
  if (apiKey.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    parsed.searchParams.set('api_key', apiKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchSafeRemoteUrl(parsed.toString(), {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`TMDB ${response.status}`);
    }
    return await readResponseJsonWithLimit(response, MAX_RESPONSE_BYTES);
  } finally {
    clearTimeout(timeout);
  }
}

function genreHasHan(genres: unknown): boolean {
  if (!Array.isArray(genres)) return false;
  return genres.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const name = (item as { name?: unknown }).name;
    return typeof name === 'string' && hasHanText(name);
  });
}

function overlayTraditionalFields(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
  mediaType: TmdbMediaType
): Record<string, unknown> {
  const titleKey = mediaType === 'tv' ? 'name' : 'title';
  const next: Record<string, unknown> = { ...primary };
  next[titleKey] = chooseTraditionalText(
    String(primary[titleKey] || ''),
    String(fallback[titleKey] || '')
  );
  next.overview = chooseTraditionalText(
    String(primary.overview || ''),
    String(fallback.overview || '')
  );
  if (!genreHasHan(primary.genres) && genreHasHan(fallback.genres)) {
    next.genres = fallback.genres;
  }
  return next;
}

async function searchCandidates(
  queries: string[],
  language: 'zh-TW' | 'zh-CN',
  apiKey: string,
  fetchJson: TmdbJsonFetcher
) {
  const found = [];
  for (const query of queries) {
    const url = `${TMDB_ORIGIN}/search/multi?language=${language}&include_adult=false&query=${encodeURIComponent(query)}`;
    found.push(...mapTmdbSearchResults(await fetchJson(url, apiKey)));
  }
  return found;
}

async function loadSeasonOverview(
  id: number,
  season: number,
  apiKey: string,
  fetchJson: TmdbJsonFetcher
): Promise<string> {
  try {
    const traditional = (await fetchJson(
      `${TMDB_ORIGIN}/tv/${id}/season/${season}?language=zh-TW`,
      apiKey
    )) as { overview?: unknown };
    const primary = String(traditional?.overview || '');
    if (hasHanText(primary)) return primary;
    const simplified = (await fetchJson(
      `${TMDB_ORIGIN}/tv/${id}/season/${season}?language=zh-CN`,
      apiKey
    )) as { overview?: unknown };
    return chooseTraditionalText(primary, String(simplified?.overview || ''));
  } catch {
    return '';
  }
}

async function loadTmdbMatch(
  query: TmdbQuery,
  apiKey: string,
  fetchJson: TmdbJsonFetcher
): Promise<TmdbMatch | null> {
  const queries = collectTmdbSearchQueries(query.title);
  if (queries.length === 0) return null;

  let picked = pickTmdbCandidate(
    await searchCandidates(queries, 'zh-TW', apiKey, fetchJson),
    query
  );
  if (!picked) {
    picked = pickTmdbCandidate(
      await searchCandidates(queries, 'zh-CN', apiKey, fetchJson),
      query
    );
  }
  if (!picked) return null;

  const detailUrl = (language: string) =>
    `${TMDB_ORIGIN}/${picked.mediaType}/${picked.id}?language=${language}&append_to_response=credits`;
  let detail = (await fetchJson(detailUrl('zh-TW'), apiKey)) as Record<
    string,
    unknown
  >;
  const titleKey = picked.mediaType === 'tv' ? 'name' : 'title';
  const needsFallback =
    !hasHanText(String(detail?.[titleKey] || '')) ||
    !hasHanText(String(detail?.overview || ''));
  if (needsFallback && detail && typeof detail === 'object') {
    const fallback = (await fetchJson(detailUrl('zh-CN'), apiKey)) as Record<
      string,
      unknown
    >;
    detail = overlayTraditionalFields(detail, fallback, picked.mediaType);
  }

  const season =
    picked.mediaType === 'tv' ? extractSeasonNumber(query.title) : null;
  const seasonText = season
    ? await loadSeasonOverview(picked.id, season, apiKey, fetchJson)
    : '';
  const seriesOverview = String(detail?.overview || '');
  // 季簡介只有在它自己是中文，或整部作品也沒有中文簡介時才蓋過作品簡介。
  const seasonOverview =
    hasHanText(seasonText) || (!hasHanText(seriesOverview) && seasonText.trim())
      ? seasonText
      : '';

  return mapTmdbDetail(detail, picked.mediaType, seasonOverview);
}

export async function lookupTmdb(
  query: TmdbQuery,
  deps: TmdbLookupDeps = {}
): Promise<TmdbMatch | null> {
  const title = query.title?.trim() || '';
  if (!title) return null;
  const apiKey = deps.apiKey ?? getTmdbApiKey();
  if (!apiKey) return null;

  const normalized = { ...query, title };
  const key = cacheKey(normalized);
  const now = deps.now ?? Date.now();
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > now) return cached.match;

  try {
    const match = await loadTmdbMatch(
      normalized,
      apiKey,
      deps.fetchJson ?? defaultFetchJson
    );
    setBoundedMapValue(
      responseCache,
      key,
      {
        match,
        expiresAt: now + (match ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
      },
      CACHE_MAX
    );
    return match;
  } catch (error) {
    logger.warn(
      'TMDB 查詢失敗:',
      error instanceof Error ? error.message : 'unknown'
    );
    return null;
  }
}
