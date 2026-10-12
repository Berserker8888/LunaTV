import { getRegionalMainlandTitles } from '@/lib/regional-title-aliases';
import { getBestTitleMatchScore } from '@/lib/searchEngine';

export type SearchYearOrder = 'none' | 'asc' | 'desc';

/**
 * 搜尋結果排序：年份 → 標題相關性評分 → 字母序 tiebreaker。
 * 自 page.tsx 抽出以便單元測試鎖住「台譯不可靠字面 ===」的契約。
 */

export function compareSearchYears(
  aYear: string,
  bYear: string,
  order: SearchYearOrder
): number {
  if (order === 'none') return 0;
  const aIsEmpty = !aYear || aYear === 'unknown';
  const bIsEmpty = !bYear || bYear === 'unknown';
  if (aIsEmpty && bIsEmpty) return 0;
  if (aIsEmpty) return 1;
  if (bIsEmpty) return -1;
  const aNum = parseInt(aYear, 10);
  const bNum = parseInt(bYear, 10);
  // parseInt 非法字串 → NaN；comparator 回傳 NaN 時 V8 排序行為未定義
  const aIsNaN = Number.isNaN(aNum);
  const bIsNaN = Number.isNaN(bNum);
  if (aIsNaN && bIsNaN) return 0;
  if (aIsNaN) return 1;
  if (bIsNaN) return -1;
  return order === 'asc' ? aNum - bNum : bNum - aNum;
}

/** 評分用查詢：使用者輸入 + 重試解析出的陸名 + regional 陸名（與比對層同一張表） */
export function getSearchScoreQueries(
  userQuery: string,
  resolvedQuery?: string
): string[] {
  const query = userQuery.trim();
  const resolved = (resolvedQuery || '').trim();
  const queries: string[] = [];
  if (query) {
    queries.push(query, ...getRegionalMainlandTitles(query));
  }
  if (resolved && resolved !== query) {
    queries.push(resolved, ...getRegionalMainlandTitles(resolved));
  }
  return Array.from(new Set(queries));
}

/**
 * 搜尋結果排序（預設路徑也會跑）。
 * yearOrder === 'none' 時跳過年份、只依相關性；有年份排序時年份優先再相關性。
 * page.tsx 必須呼叫此函式，不可在 yearOrder none 時提前 return。
 *
 * 評分採 Schwartzian：先對每個 title 算一次 getBestTitleMatchScore，
 * 避免 sort comparator 內 O(N log N) 次重複跑 LCS DP。
 */
export function sortSearchItems<T extends { title: string; year?: string }>(
  items: T[],
  userQuery: string,
  yearOrder: SearchYearOrder,
  resolvedQuery?: string
): T[] {
  if (items.length <= 1) return items;
  const scoreQueries = getSearchScoreQueries(userQuery, resolvedQuery);
  const titleOrder: 'asc' | 'desc' = yearOrder === 'desc' ? 'desc' : 'asc';

  const itemScores = new Map<string, number>();
  for (const item of items) {
    if (!itemScores.has(item.title)) {
      itemScores.set(
        item.title,
        getBestTitleMatchScore(item.title, scoreQueries)
      );
    }
  }

  return [...items].sort((a, b) => {
    const yearComp = compareSearchYears(
      a.year ?? 'unknown',
      b.year ?? 'unknown',
      yearOrder
    );
    if (yearComp !== 0) return yearComp;

    const scoreDiff =
      (itemScores.get(b.title) ?? 0) - (itemScores.get(a.title) ?? 0);
    if (scoreDiff !== 0) return scoreDiff;

    return titleOrder === 'asc'
      ? a.title.localeCompare(b.title)
      : b.title.localeCompare(a.title);
  });
}
