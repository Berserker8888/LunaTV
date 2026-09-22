'use client';

import { fetchWithAuth } from './api';
import { cacheManager } from './cache';
import {
  type Favorite,
  FAVORITES_KEY,
  PLAY_RECORDS_KEY,
  type PlayRecord,
  STORAGE_TYPE,
} from './shared';
import {
  acknowledgeSeenEpisodes,
  type EpisodeAware,
  positiveEpisodeCount,
} from '../episode-awareness';
import { generateStorageKey } from '../storage-key';

function replaceCachedPlayRecord(key: string, record: PlayRecord): void {
  const cached = cacheManager.getCachedPlayRecords();
  if (!cached) return;
  const next = { ...cached, [key]: record };
  cacheManager.cachePlayRecords(next);
  window.dispatchEvent(
    new CustomEvent('playRecordsUpdated', {
      detail: next,
    })
  );
}

function replaceCachedFavorite(key: string, favorite: Favorite): void {
  const cached = cacheManager.getCachedFavorites();
  if (!cached) return;
  const next = { ...cached, [key]: favorite };
  cacheManager.cacheFavorites(next);
  window.dispatchEvent(
    new CustomEvent('favoritesUpdated', {
      detail: next,
    })
  );
}

function patchLocalStorage(
  storageKey: string,
  recordKey: string,
  eventName: string,
  seen: number,
  skipLive: boolean
): void {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;
  const all = JSON.parse(raw) as Record<
    string,
    EpisodeAware & { origin?: string }
  >;
  const existing = all[recordKey];
  if (!existing) return;
  if (skipLive && existing.origin === 'live') return;
  const result = acknowledgeSeenEpisodes(existing, seen);
  if (!result.changed) return;
  all[recordKey] = result.next;
  localStorage.setItem(storageKey, JSON.stringify(all));
  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: all,
    })
  );
}

/**
 * 播放頁確認使用者已經看到這份集數列表。
 * 遠端儲存寫回帳號；localstorage 只改這台瀏覽器。
 */
export async function acknowledgeEpisodeCount(
  source: string,
  id: string,
  totalEpisodes: number
): Promise<boolean> {
  const seen = positiveEpisodeCount(totalEpisodes);
  if (!source || !id || !seen || typeof window === 'undefined') return false;
  const key = generateStorageKey(source, id);

  if (STORAGE_TYPE === 'localstorage') {
    try {
      patchLocalStorage(
        PLAY_RECORDS_KEY,
        key,
        'playRecordsUpdated',
        seen,
        false
      );
      patchLocalStorage(FAVORITES_KEY, key, 'favoritesUpdated', seen, true);
      return true;
    } catch (err) {
      console.warn('標記已看集數失敗:', err);
      return false;
    }
  }

  try {
    const response = await fetchWithAuth('/api/library/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, total_episodes: seen }),
    });
    const payload = (await response.json()) as {
      playRecord?: PlayRecord | null;
      favorite?: Favorite | null;
    };
    if (payload.playRecord) replaceCachedPlayRecord(key, payload.playRecord);
    if (payload.favorite && payload.favorite.origin !== 'live') {
      replaceCachedFavorite(key, payload.favorite);
    }
    return true;
  } catch (err) {
    console.warn('標記已看集數失敗:', err);
    return false;
  }
}
