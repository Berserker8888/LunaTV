import { cleanQueryForApi, toSearchSimplified } from './chinese';
import { convertTaiwanToMainland } from './opencc-mainland';

/**
 * 以 TMDB alternative_titles 作為「台灣片名 → 大陸片名」的第二別名來源。
 *
 * 豆瓣反查（douban-alias）是第一順位，但豆瓣搜尋 API 實測會被限流、
 * 且依賴第三方代理；TMDB 有官方 alternative_titles＋translations 端點，
 * 直接收錄各地區譯名與官方中文在地化，穩定度高，適合作為備援。
 *
 * 流程：TMDB 搜尋（movie＋tv）→ 取首筆 ID →
 * 打 alternative_titles＋translations →
 * 依 CN＞TW＞HK＞其他中日韓標題的順序抽取別名
 * （同地區內官方在地化 translations 優先於上映別名）。
 *
 * 此模組僅負責「組請求」與「解析回應」兩件純邏輯，方便單元測試；
 * 實際發送、授權與快取由 API 路由處理。
 */

const TMDB_ORIGIN = 'https://api.themoviedb.org/3';
const CJK_PATTERN = /[㐀-鿿]/;

export type TmdbAliasMediaType = 'movie' | 'tv';

interface TmdbSearchItem {
  id?: number;
  title?: string;
  name?: string;
}

export interface TmdbSearchResponse {
  results?: TmdbSearchItem[];
  total_results?: number;
}

interface TmdbAltTitle {
  iso_3166_1?: string;
  title?: string;
}

export interface TmdbAlternativeTitlesResponse {
  id?: number;
  /** 電影端點用 titles，劇集端點用 results，兩種都要吃 */
  titles?: TmdbAltTitle[];
  results?: TmdbAltTitle[];
}

export interface TmdbTranslation {
  iso_3166_1?: string;
  iso_639_1?: string;
  data?: { title?: string };
}

export interface TmdbTranslationsResponse {
  id?: number;
  translations?: TmdbTranslation[];
}

export interface TmdbAliasCandidate {
  mediaType: TmdbAliasMediaType;
  tmdbId: number;
}

/** 搜尋 TMDB 作品。language 固定 zh-TW：使用者以台灣片名查詢。 */
export function buildTmdbSearchUrl(
  mediaType: TmdbAliasMediaType,
  query: string,
  language = 'zh-TW'
): string {
  const params = new URLSearchParams({
    query,
    language,
    page: '1',
    include_adult: 'false',
  });
  return `${TMDB_ORIGIN}/search/${mediaType}?${params.toString()}`;
}

/** 取作品的各地區譯名。注意劇集端點回傳 key 是 results 不是 titles。 */
export function buildTmdbAlternativeTitlesUrl(
  mediaType: TmdbAliasMediaType,
  tmdbId: number
): string {
  return `${TMDB_ORIGIN}/${mediaType}/${tmdbId}/alternative_titles`;
}

/**
 * 取作品的官方在地化標題。
 *
 * 動漫的簡體中文名經常只出現在 translations（zh-CN 在地化），
 * 不會出現在 alternative_titles（那是各地「上映別名」）。例如多數
 * 番劇的中文名只有 translations 有收，不加這個動漫就查不到。
 */
export function buildTmdbTranslationsUrl(
  mediaType: TmdbAliasMediaType,
  tmdbId: number
): string {
  return `${TMDB_ORIGIN}/${mediaType}/${tmdbId}/translations`;
}

/**
 * 把 API 金鑰套用到請求上。與 tmdb.ts 的 defaultFetchJson 同一規則：
 * v4 權杖是 JWT（eyJ 開頭）走 Authorization 標頭，v3 金鑰放查詢參數。
 * 抽成純函式方便測試；呼叫端負責把回傳的 headers 帶上。
 */
export function applyTmdbAuth(
  url: string,
  apiKey: string
): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${apiKey}`;
    return { url, headers };
  }
  const parsed = new URL(url);
  parsed.searchParams.set('api_key', apiKey);
  return { url: parsed.toString(), headers };
}

/**
 * 從 movie／tv 搜尋結果各取首筆 ID。
 *
 * TMDB 搜尋依相關度排序，片名查詢的首筆通常就是正確作品；
 * 兩種媒體類型都取是因為不知道使用者搜的是電影還是劇集。
 */
export function pickTmdbCandidateIds(
  movieSearch: TmdbSearchResponse,
  tvSearch: TmdbSearchResponse
): TmdbAliasCandidate[] {
  const candidates: TmdbAliasCandidate[] = [];
  const movieId = movieSearch.results?.[0]?.id;
  if (typeof movieId === 'number' && movieId > 0) {
    candidates.push({ mediaType: 'movie', tmdbId: movieId });
  }
  const tvId = tvSearch.results?.[0]?.id;
  if (typeof tvId === 'number' && tvId > 0) {
    candidates.push({ mediaType: 'tv', tmdbId: tvId });
  }
  return candidates;
}

/** 地區別名優先順序：大陸譯名最優先，其次台港，其他中日韓標題殿後 */
function altTitlePriority(iso: string): number {
  switch (iso) {
    case 'CN':
      return 0;
    case 'TW':
      return 1;
    case 'HK':
      return 2;
    default:
      return 3;
  }
}

interface ScoredTitle {
  title: string;
  /** 地區別名優先順序：大陸譯名最優先，其次台港，其他中日韓標題殿後 */
  region: number;
  /** 來源優先順序：translations（官方在地化）優先於 alternative_titles（上映別名） */
  source: number;
  order: number;
}

/**
 * 從 alternative_titles＋translations 回應抽取可用的別名。
 *
 * 只保留含中日韓字且「與原查詢確實不同」的標題——若轉換後相同，
 * 代表本來就搜得到，不需要別名。排序：CN＞TW＞HK＞其他；
 * 同地區內官方在地化（translations）排在上映別名前。
 */
export function extractTmdbTitleAliases(
  alternativeTitles: TmdbAlternativeTitlesResponse[],
  translations: TmdbTranslationsResponse[],
  originalQuery: string,
  limit = 3
): string[] {
  const baseline = toSearchSimplified(
    convertTaiwanToMainland(cleanQueryForApi(originalQuery))
  ).trim();

  const scored: ScoredTitle[] = [];
  let order = 0;
  const push = (rawTitle: string | undefined, iso: string, source: number) => {
    order += 1;
    const title = (rawTitle || '').trim();
    if (!title || !CJK_PATTERN.test(title)) return;
    const normalized = toSearchSimplified(title).trim();
    if (!normalized || normalized === baseline) return;
    scored.push({
      title: normalized,
      region: altTitlePriority((iso || '').toUpperCase()),
      source,
      order,
    });
  };

  for (const payload of translations) {
    for (const t of payload.translations || []) {
      if ((t.iso_639_1 || '').toLowerCase() !== 'zh') continue;
      push(t.data?.title, t.iso_3166_1 || '', 0);
    }
  }
  for (const payload of alternativeTitles) {
    const items = payload.titles || payload.results || [];
    for (const item of items) {
      push(item.title, item.iso_3166_1 || '', 1);
    }
  }

  scored.sort(
    (a, b) => a.region - b.region || a.source - b.source || a.order - b.order
  );

  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const { title } of scored) {
    if (seen.has(title)) continue;
    seen.add(title);
    aliases.push(title);
    if (aliases.length >= limit) break;
  }
  return aliases;
}

/** TMDB 搜尋是否真的有打中作品（區別於「有回應但零結果」） */
export function hasTmdbSearchHits(payload: TmdbSearchResponse): boolean {
  return (payload.results?.length || 0) > 0;
}
