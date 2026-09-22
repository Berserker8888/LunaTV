/**
 * 集數「使用者已知」與「片源實際」的差額。
 *
 * known_episodes 是使用者上次看到的總集數。片源變多而這個數字沒跟上，
 * 首頁才顯示「有新集」。沒看完舊集（index 比較小）不算新集。
 */

export interface EpisodeAware {
  total_episodes?: number;
  known_episodes?: number;
}

export type EpisodeSnapshot<T> = Omit<
  T,
  'total_episodes' | 'known_episodes'
> & {
  total_episodes: number;
  known_episodes: number;
};

export function positiveEpisodeCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

/** 片源比使用者上次知道的還多幾集。0 代表沒有可顯示的更新。 */
export function newEpisodeCount(
  item: EpisodeAware & { episodes?: number }
): number {
  const total = positiveEpisodeCount(item.total_episodes ?? item.episodes);
  const known = positiveEpisodeCount(item.known_episodes);
  if (!known || total <= known) return 0;
  return total - known;
}

export function hasNewEpisodes(
  item: EpisodeAware & { episodes?: number }
): boolean {
  return newEpisodeCount(item) > 0;
}

/**
 * Cron 發現片源集數變多。
 *
 * 已有總集數時，把舊總集數留下當 known，這樣差額才顯示得出來。
 * 第一次從 0 學到真實集數只是建立基準，不當成有新集。
 */
export function applyDiscoveredEpisodeCount<T extends EpisodeAware>(
  existing: T,
  discovered: number
): { changed: boolean; next: EpisodeSnapshot<T> } {
  const nextTotal = positiveEpisodeCount(discovered);
  const currentTotal = positiveEpisodeCount(existing.total_episodes);
  if (!nextTotal || nextTotal <= currentTotal) {
    return {
      changed: false,
      next: {
        ...existing,
        total_episodes: currentTotal,
        known_episodes: positiveEpisodeCount(existing.known_episodes),
      },
    };
  }

  const existingKnown = positiveEpisodeCount(existing.known_episodes);
  const known =
    existingKnown > 0
      ? existingKnown
      : currentTotal >= 1
        ? currentTotal
        : nextTotal;

  return {
    changed: true,
    next: {
      ...existing,
      total_episodes: nextTotal,
      known_episodes: known,
    },
  };
}

/**
 * 使用者打開了這份集數列表。
 *
 * 比已儲存總集數更短的回應（詳情暫時缺集）直接忽略，
 * 避免把「有新集」洗掉，或把殘缺列表當成已看過。
 */
export function acknowledgeSeenEpisodes<T extends EpisodeAware>(
  existing: T,
  seenTotal: number
): { changed: boolean; next: EpisodeSnapshot<T> } {
  const seen = positiveEpisodeCount(seenTotal);
  const existingTotal = positiveEpisodeCount(existing.total_episodes);
  const unchanged = {
    ...existing,
    total_episodes: existingTotal,
    known_episodes: positiveEpisodeCount(existing.known_episodes),
  };
  if (!seen) return { changed: false, next: unchanged };

  if (existingTotal > 0 && seen < existingTotal) {
    return { changed: false, next: unchanged };
  }

  const total = Math.max(existingTotal, seen);
  const known = Math.max(positiveEpisodeCount(existing.known_episodes), seen);
  if (
    known === positiveEpisodeCount(existing.known_episodes) &&
    total === existingTotal
  ) {
    return { changed: false, next: unchanged };
  }

  return {
    changed: true,
    next: {
      ...existing,
      total_episodes: total,
      known_episodes: known,
    },
  };
}

interface SeenRecord extends EpisodeAware {
  title?: string;
  source_name?: string;
  year?: string;
  cover?: string;
  search_title?: string;
  save_time?: number;
  origin?: 'vod' | 'live';
  index?: number;
  play_time?: number;
  total_time?: number;
  vod_id?: string;
  source?: string;
  id?: string;
}

function seenEpisodeTotal(
  incomingTotal: number,
  existingTotal: number
): number {
  if (incomingTotal <= 0) return 0;
  if (existingTotal === 0 || incomingTotal >= existingTotal)
    return incomingTotal;
  return 0;
}

function resolveKnownEpisodes(
  existing: SeenRecord,
  incoming: SeenRecord,
  incomingTotal: number,
  existingTotal: number
): number {
  return Math.max(
    positiveEpisodeCount(existing.known_episodes) || existingTotal,
    positiveEpisodeCount(incoming.known_episodes),
    seenEpisodeTotal(incomingTotal, existingTotal)
  );
}

/** 播放進度存檔。較新的進度留下，但總集數只升不降。 */
export function mergeSeenPlayRecord<T extends SeenRecord>(
  existing: T | null,
  incoming: T
): EpisodeSnapshot<T> {
  const incomingTotal = positiveEpisodeCount(incoming.total_episodes);
  if (!existing) {
    const total = incomingTotal || 1;
    return {
      ...incoming,
      total_episodes: total,
      known_episodes: positiveEpisodeCount(incoming.known_episodes) || total,
    };
  }

  const existingTotal = positiveEpisodeCount(existing.total_episodes);
  const total = Math.max(incomingTotal, existingTotal) || 1;
  const incomingIndex = positiveEpisodeCount(incoming.index);

  return {
    ...existing,
    ...incoming,
    title: incoming.title || existing.title,
    source_name: incoming.source_name || existing.source_name,
    year: incoming.year || existing.year,
    cover: incoming.cover || existing.cover,
    search_title: incoming.search_title || existing.search_title,
    total_episodes: total,
    known_episodes: resolveKnownEpisodes(
      existing,
      incoming,
      incomingTotal,
      existingTotal
    ),
    index: incomingIndex || existing.index,
    play_time: Number.isFinite(incoming.play_time)
      ? incoming.play_time
      : existing.play_time,
    total_time:
      Number.isFinite(incoming.total_time) && Number(incoming.total_time) > 0
        ? incoming.total_time
        : existing.total_time,
    save_time: incoming.save_time || existing.save_time,
    vod_id: incoming.vod_id || existing.vod_id,
    source: incoming.source || existing.source,
  };
}

/** 收藏存檔。同樣不讓較短的集數列表蓋掉已發現的新集。 */
export function mergeSeenFavorite<T extends SeenRecord>(
  existing: T | null,
  incoming: T
): EpisodeSnapshot<T> {
  const incomingTotal = positiveEpisodeCount(incoming.total_episodes);
  if (!existing) {
    const total = incomingTotal || 1;
    return {
      ...incoming,
      total_episodes: total,
      known_episodes: positiveEpisodeCount(incoming.known_episodes) || total,
      origin: incoming.origin,
    };
  }

  const existingTotal = positiveEpisodeCount(existing.total_episodes);
  const total =
    Math.max(incomingTotal, existingTotal) || existing.total_episodes || 1;

  return {
    ...existing,
    ...incoming,
    title: incoming.title || existing.title,
    source_name: incoming.source_name || existing.source_name,
    year: incoming.year || existing.year,
    cover: incoming.cover || existing.cover,
    search_title: incoming.search_title || existing.search_title,
    origin: incoming.origin || existing.origin,
    save_time: incoming.save_time || existing.save_time,
    total_episodes: total,
    known_episodes: resolveKnownEpisodes(
      existing,
      incoming,
      incomingTotal,
      existingTotal
    ),
  };
}
