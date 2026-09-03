import {
  cleanQueryForApi,
  convertJapaneseParticlesForSearch,
  generateSearchVariants,
  toSearchSimplified,
} from './chinese';
import { convertTaiwanToMainland } from './opencc-mainland';
import {
  getRegionalMainlandTitles,
  getRuntimeCustomAliases,
  type RegionalTitleAlias,
} from './regional-title-aliases';
import { extractSeason } from './titleParser';

const CJK_PATTERN = /[\u3400-\u9fff]/;
const KANA_PATTERN = /[\u3040-\u30ff]/;
const MAX_MAINLAND_SEARCH_QUERIES = 6;
const TITLE_PART_SPLIT = /[，,：:｜|—–\-~～・·×]+/;

function normalizeMainlandQuery(
  value: string,
  preserveMetadata = false
): string {
  const input = preserveMetadata ? value : cleanQueryForApi(value || '');
  return toSearchSimplified(convertTaiwanToMainland(input))
    .replace(/[【】[\]（）()《》]/g, ' ')
    .replace(/[☆★♪♥♡※＊*×✕✖·・～~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMainlandQueryable(value: string): boolean {
  return Boolean(value && CJK_PATTERN.test(value) && !KANA_PATTERN.test(value));
}

/**
 * 「進撃の巨人」應能送「进击的巨人」；「はたらく細胞」這種幾乎全假名
 * 的標題不該被洗成「細胞」這種過短泛詞。剩餘漢字夠長才剝假名。
 */
function prepareMainlandSourceQuery(query: string): string {
  const converted = convertJapaneseParticlesForSearch(query);
  if (!KANA_PATTERN.test(converted)) return converted;
  const stripped = converted
    .replace(/[\u3040-\u30ff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const compact = stripped.replace(/\s/g, '');
  if (CJK_PATTERN.test(stripped) && compact.length >= 4) return stripped;
  return converted;
}

/**
 * Build a small, ordered query plan for mainland CMS sources.
 *
 * The exact simplified-Chinese query always runs first. Broader generated
 * variants are only fallbacks and never include Japanese or English titles.
 */
export function getMainlandSearchQueries(
  query: string,
  customAliases: RegionalTitleAlias[] = getRuntimeCustomAliases()
): string[] {
  const prepared = prepareMainlandSourceQuery(query);
  const exact = normalizeMainlandQuery(prepared, true);
  const exactOk = isMainlandQueryable(exact);

  const season = extractSeason(query);
  const regionalAliases = Array.from(
    new Set([
      ...getRegionalMainlandTitles(query, customAliases),
      ...getRegionalMainlandTitles(prepared, customAliases),
    ])
  )
    .map((alias) => normalizeMainlandQuery(alias, true))
    .filter(isMainlandQueryable);

  const generated = generateSearchVariants(prepared)
    // 季數比對必須在正規化「之前」做。normalizeMainlandQuery 預設會呼叫
    // cleanQueryForApi 把季數剝掉，剝完再比對 extractSeason(variant) === season
    // 必然不相等——結果是只要查詢帶明確季數，所有生成變體都被濾光，
    // 該查詢完全沒有備援（例如「鬼滅之刃 第二季」只送得出一個查詢）。
    .filter((variant) => season === null || extractSeason(variant) === season)
    // 帶季數時保留 metadata，讓季數留在實際送出的查詢裡；不帶季數時維持
    // 原本的行為（剝除季數等中繼資訊以提高片源命中率）。
    .map((variant) => normalizeMainlandQuery(variant, season !== null))
    .filter(isMainlandQueryable);

  const titleParts = prepared
    .split(TITLE_PART_SPLIT)
    .map((part) => normalizeMainlandQuery(part, true))
    .filter((part) => isMainlandQueryable(part) && part.length >= 4);

  const ordered = exactOk
    ? [...regionalAliases, exact, ...titleParts, ...generated]
    : [...regionalAliases, ...titleParts, ...generated];

  return Array.from(new Set(ordered.filter(isMainlandQueryable))).slice(
    0,
    MAX_MAINLAND_SEARCH_QUERIES
  );
}
