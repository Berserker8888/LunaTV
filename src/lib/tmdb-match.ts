import { cleanQueryForApi, toDisplayLanguage } from './chinese';
import { positiveEpisodeCount } from './episode-awareness';
import {
  getRegionalMainlandTitles,
  getRuntimeCustomAliases,
  mergeAndSortAliases,
} from './regional-title-aliases';
import { normalizeTitle } from './string-utils';

export type TmdbMediaType = 'movie' | 'tv';

export interface TmdbSearchCandidate {
  id: number;
  mediaType: TmdbMediaType;
  title: string;
  originalTitle: string;
  date: string;
  popularity: number;
  voteCount: number;
}

export interface TmdbQuery {
  title: string;
  year?: string;
  episodes?: number;
  typeName?: string;
  category?: string;
}

export interface TmdbCredit {
  name: string;
  character?: string;
}

export interface TmdbMatch {
  id: number;
  mediaType: TmdbMediaType;
  title: string;
  originalTitle: string;
  overview: string;
  year: string;
  voteAverage: number | null;
  genres: string[];
  cast: TmdbCredit[];
  director: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  tmdbUrl: string;
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseSeasonToken(raw: string): number | null {
  if (/^\d{1,2}$/.test(raw)) {
    const value = Number(raw);
    return value >= 1 && value <= 60 ? value : null;
  }

  if (raw === '十') return 10;
  const tenIndex = raw.indexOf('十');
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : CN_DIGITS[raw[tenIndex - 1]];
    const ones = tenIndex === raw.length - 1 ? 0 : CN_DIGITS[raw[tenIndex + 1]];
    if (tens == null || ones == null) return null;
    const value = tens * 10 + ones;
    return value >= 1 && value <= 60 ? value : null;
  }

  if (raw.length === 1 && CN_DIGITS[raw] != null && CN_DIGITS[raw] > 0) {
    return CN_DIGITS[raw];
  }
  return null;
}

/** 從片名取出季數。沒寫季數就回傳 null，讓 TMDB 用整部作品。 */
export function extractSeasonNumber(title: string): number | null {
  const matched =
    title.match(/第\s*([0-9]{1,2}|[零一二兩三四五六七八九十]{1,3})\s*季/) ||
    title.match(/Season\s*(\d{1,2})/i) ||
    title.match(/\bS(\d{1,2})(?:E\d{1,3})?\b/i);
  if (!matched) return null;
  return parseSeasonToken(matched[1]);
}

export function preferTmdbMediaType(
  input: Pick<TmdbQuery, 'episodes' | 'typeName' | 'category'>
): TmdbMediaType | 'any' {
  const hint = toDisplayLanguage(
    `${input.typeName || ''} ${input.category || ''}`
  );
  const episodes = positiveEpisodeCount(input.episodes);
  if (/電影|紀錄片/.test(hint) && episodes <= 1) return 'movie';
  if (/劇|綜藝|動漫|動畫|番/.test(hint)) return 'tv';
  if (episodes > 1) return 'tv';
  if (episodes === 1) return 'movie';
  return 'any';
}

function readYear(value?: string): number | null {
  const matched = String(value || '').match(/(?:19|20)\d{2}/);
  return matched ? Number(matched[0]) : null;
}

function normalizedTitles(title: string): string[] {
  const values = [
    normalizeTitle(title),
    normalizeTitle(cleanQueryForApi(title)),
  ].filter(Boolean);
  return Array.from(new Set(values));
}

function titlesOverlap(
  left: string[],
  right: string[]
): {
  exact: boolean;
  partial: boolean;
} {
  const exact = left.some((item) => right.includes(item));
  if (exact) return { exact: true, partial: false };
  const partial = left.some((queryTitle) =>
    right.some((candidateTitle) => {
      if (queryTitle.length < 2 || candidateTitle.length < 2) return false;
      const shorter = Math.min(queryTitle.length, candidateTitle.length);
      const longer = Math.max(queryTitle.length, candidateTitle.length);
      if (shorter / longer < 0.6) return false;
      return (
        candidateTitle.includes(queryTitle) ||
        queryTitle.includes(candidateTitle)
      );
    })
  );
  return { exact: false, partial };
}

/** 搜尋詞：使用者看到的片名，加上台譯／陸名對照。最多 3 條。 */
export function collectTmdbSearchQueries(title: string): string[] {
  const cleaned = cleanQueryForApi(title).trim() || title.trim();
  if (!cleaned) return [];

  const queries = [cleaned];
  queries.push(...getRegionalMainlandTitles(cleaned));

  const display = toDisplayLanguage(cleaned);
  for (const alias of mergeAndSortAliases(getRuntimeCustomAliases())) {
    const mainland = toDisplayLanguage(alias.cn);
    if (!mainland || !display.includes(mainland)) continue;
    queries.push(display.replace(mainland, alias.tw));
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const value = query.trim();
    const key = normalizeTitle(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
    if (unique.length >= 3) break;
  }
  return unique;
}

export function scoreTmdbCandidate(
  candidate: TmdbSearchCandidate,
  query: TmdbQuery
): number {
  const queryTitles = normalizedTitles(query.title);
  const candidateTitles = [
    ...normalizedTitles(candidate.title),
    ...normalizedTitles(candidate.originalTitle),
  ];
  if (queryTitles.length === 0 || candidateTitles.length === 0) return 0;

  const overlap = titlesOverlap(
    queryTitles,
    Array.from(new Set(candidateTitles))
  );
  if (!overlap.exact && !overlap.partial) return 0;

  let score = overlap.exact ? 100 : 60;
  const candidateYear = readYear(candidate.date);
  const queryYear = readYear(query.year);
  if (candidateYear != null && queryYear != null) {
    const delta = Math.abs(candidateYear - queryYear);
    // 劇集頁上的年份常是這一季，TMDB 記的是系列首播，差個幾年仍是同一部。
    // 電影差超過一年就很可能是同名重啟作。
    const tvLike =
      candidate.mediaType === 'tv' || preferTmdbMediaType(query) === 'tv';
    const maxDelta = tvLike ? 20 : 1;
    if (delta === 0) score += 25;
    else if (delta === 1) score += 12;
    else if (delta <= maxDelta) score += 4;
    else score -= 40;
  }

  const prefer = preferTmdbMediaType(query);
  if (prefer !== 'any') {
    score += candidate.mediaType === prefer ? 15 : -8;
  }
  if (candidate.voteCount >= 20) score += 3;
  return score;
}

export function pickTmdbCandidate(
  candidates: TmdbSearchCandidate[],
  query: TmdbQuery
): TmdbSearchCandidate | null {
  let best: { candidate: TmdbSearchCandidate; score: number } | null = null;
  for (const candidate of candidates) {
    const score = scoreTmdbCandidate(candidate, query);
    if (!best || score > best.score) best = { candidate, score };
  }
  if (!best || best.score < 90) return null;
  return best.candidate;
}

export function mapTmdbSearchResults(
  payload: unknown,
  fallbackType?: TmdbMediaType
): TmdbSearchCandidate[] {
  const results = Array.isArray((payload as { results?: unknown })?.results)
    ? (payload as { results: unknown[] }).results
    : [];
  const mapped: TmdbSearchCandidate[] = [];

  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const explicit = record.media_type;
    const mediaType: TmdbMediaType | null =
      explicit === 'movie' || explicit === 'tv'
        ? explicit
        : fallbackType ||
          (typeof record.title === 'string'
            ? 'movie'
            : typeof record.name === 'string'
              ? 'tv'
              : null);
    if (mediaType !== 'movie' && mediaType !== 'tv') continue;

    const title = mediaType === 'tv' ? record.name : record.title;
    const original =
      mediaType === 'tv' ? record.original_name : record.original_title;
    const id = Number(record.id);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      typeof title !== 'string' ||
      !title.trim()
    ) {
      continue;
    }

    mapped.push({
      id,
      mediaType,
      title,
      originalTitle: typeof original === 'string' ? original : '',
      date: String(record.first_air_date || record.release_date || ''),
      popularity: Number(record.popularity) || 0,
      voteCount: Number(record.vote_count) || 0,
    });
  }

  return mapped;
}

function imageUrl(path: unknown, size: 'w342' | 'w780'): string | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function readNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const name = (item as { name?: unknown }).name;
      return typeof name === 'string' ? toDisplayLanguage(name.trim()) : '';
    })
    .filter(Boolean);
}

function readVote(value: unknown): number | null {
  const vote = Number(value);
  if (!Number.isFinite(vote) || vote <= 0) return null;
  return Math.round(vote * 10) / 10;
}

export function mapTmdbDetail(
  detail: unknown,
  mediaType: TmdbMediaType,
  seasonOverview?: string
): TmdbMatch | null {
  if (!detail || typeof detail !== 'object') return null;
  const record = detail as Record<string, unknown>;
  const id = Number(record.id);
  if (!Number.isInteger(id) || id <= 0) return null;

  const rawTitle = mediaType === 'tv' ? record.name : record.title;
  const rawOriginal =
    mediaType === 'tv' ? record.original_name : record.original_title;
  const title =
    typeof rawTitle === 'string' ? toDisplayLanguage(rawTitle.trim()) : '';
  if (!title) return null;

  const credits =
    record.credits && typeof record.credits === 'object'
      ? (record.credits as Record<string, unknown>)
      : {};
  const cast = Array.isArray(credits.cast)
    ? credits.cast
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const credit = item as { name?: unknown; character?: unknown };
          const name =
            typeof credit.name === 'string'
              ? toDisplayLanguage(credit.name.trim())
              : '';
          if (!name) return null;
          const character =
            typeof credit.character === 'string'
              ? toDisplayLanguage(credit.character.trim())
              : '';
          return character && character !== name
            ? { name, character }
            : { name };
        })
        .filter((item): item is TmdbCredit => Boolean(item))
        .slice(0, 6)
    : [];

  const crewDirector = Array.isArray(credits.crew)
    ? credits.crew.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const job = (item as { job?: unknown }).job;
        return job === 'Director' || job === '導演';
      })
    : null;
  const createdBy = readNames(record.created_by);
  const director =
    mediaType === 'tv'
      ? createdBy[0] || ''
      : crewDirector && typeof crewDirector === 'object'
        ? toDisplayLanguage(
            String((crewDirector as { name?: unknown }).name || '').trim()
          )
        : '';

  const overviewSource =
    seasonOverview?.trim() ||
    (typeof record.overview === 'string' ? record.overview.trim() : '');
  const date = String(record.first_air_date || record.release_date || '');

  return {
    id,
    mediaType,
    title,
    originalTitle: typeof rawOriginal === 'string' ? rawOriginal.trim() : '',
    overview: overviewSource ? toDisplayLanguage(overviewSource) : '',
    year: readYear(date)?.toString() || '',
    voteAverage: readVote(record.vote_average),
    genres: readNames(record.genres).slice(0, 4),
    cast,
    director,
    posterUrl: imageUrl(record.poster_path, 'w342'),
    backdropUrl: imageUrl(record.backdrop_path, 'w780'),
    tmdbUrl: `https://www.themoviedb.org/${mediaType}/${id}?language=zh-TW`,
  };
}

export function hasHanText(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function translationList(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return [];
  const wrapped = (payload as { translations?: unknown }).translations;
  if (Array.isArray(wrapped)) return wrapped as Array<Record<string, unknown>>;
  if (wrapped && typeof wrapped === 'object') {
    const nested = (wrapped as { translations?: unknown }).translations;
    if (Array.isArray(nested)) return nested as Array<Record<string, unknown>>;
  }
  return [];
}

function chineseRank(language: string, region: string): number {
  if (language !== 'zh') return 0;
  if (region === 'TW' || region === 'HK') return 3;
  if (region === 'CN') return 2;
  return 1;
}

/**
 * 從 TMDB translations 挑中文標題與簡介。
 * 繁中優先；繁中沒有簡介時用簡中，之後再轉成繁中。
 */
export function pickChineseCopy(
  translations: unknown,
  mediaType: TmdbMediaType
): { title: string; overview: string } {
  let title = '';
  let titleRank = 0;
  let overview = '';
  let overviewRank = 0;
  const titleKey = mediaType === 'tv' ? 'name' : 'title';

  for (const item of translationList(translations)) {
    const rank = chineseRank(
      String(item.iso_639_1 || ''),
      String(item.iso_3166_1 || '')
    );
    if (!rank || !item.data || typeof item.data !== 'object') continue;
    const data = item.data as Record<string, unknown>;
    const nextTitle = String(
      data[titleKey] || data.title || data.name || ''
    ).trim();
    const nextOverview = String(data.overview || '').trim();
    if (nextTitle && hasHanText(nextTitle) && rank > titleRank) {
      title = nextTitle;
      titleRank = rank;
    }
    if (nextOverview && hasHanText(nextOverview) && rank > overviewRank) {
      overview = nextOverview;
      overviewRank = rank;
    }
  }

  return { title, overview };
}

export function chooseTraditionalText(
  primary: string,
  fallback: string
): string {
  const first = primary.trim();
  const second = fallback.trim();
  if (hasHanText(first)) return toDisplayLanguage(first);
  if (second) return toDisplayLanguage(second);
  return first;
}
