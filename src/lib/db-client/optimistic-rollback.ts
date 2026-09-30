'use client';

/**
 * 樂觀更新 rollback 輔助。
 *
 * 問題：樂觀更新先在快照上寫入、失敗時把整份快照寫回去；若失敗前已有另一次
 * 成功的寫入（或另一分頁寫入）動過快取，整份還原會蓋掉較新的資料。
 *
 * 做法：還原前先比對——只有「目前仍是我們樂觀寫入的樣子」才還原；一旦被
 * 後續寫入動過就保留現狀（失敗的那筆會由後續同步自癒）。
 */

function isSameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * key-value 型快取的 rollback：只有該 key 目前仍是樂觀寫入的值時，
 * 才把它還原成舊值（prevValue 為 undefined 表示該 key 原本不存在）。
 * 回傳是否真的執行了還原。
 */
export function rollbackOptimisticKey<T>(
  latest: Record<string, T> | null | undefined,
  key: string,
  optimisticValue: T,
  prevValue: T | undefined,
  commit: (rolledBack: Record<string, T>) => void
): boolean {
  const current = latest || {};
  if (!isSameJson(current[key], optimisticValue)) return false;
  const rolledBack = { ...current };
  if (prevValue === undefined) {
    delete rolledBack[key];
  } else {
    rolledBack[key] = prevValue;
  }
  commit(rolledBack);
  return true;
}

/**
 * 陣列型快取（搜尋歷史）的 rollback：只有陣列仍是樂觀寫入的樣子時，
 * 才還原成舊陣列。回傳是否真的執行了還原。
 */
export function rollbackOptimisticArray<T>(
  latest: T[] | null | undefined,
  optimisticArray: T[],
  prevArray: T[],
  commit: (rolledBack: T[]) => void
): boolean {
  if (!isSameJson(latest || [], optimisticArray)) return false;
  commit([...prevArray]);
  return true;
}
