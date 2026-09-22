import {
  acknowledgeSeenEpisodes,
  applyDiscoveredEpisodeCount,
  hasNewEpisodes,
  mergeSeenFavorite,
  mergeSeenPlayRecord,
  newEpisodeCount,
} from './episode-awareness';

describe('applyDiscoveredEpisodeCount', () => {
  it('已有總集數時把舊數字留下，首頁才知道多了幾集', () => {
    const result = applyDiscoveredEpisodeCount(
      { total_episodes: 12, title: '示例' },
      14
    );

    expect(result.changed).toBe(true);
    expect(result.next.total_episodes).toBe(14);
    expect(result.next.known_episodes).toBe(12);
    expect(newEpisodeCount(result.next)).toBe(2);
  });

  it('第一次從 0 學到集數只建立基準，不顯示有新集', () => {
    const result = applyDiscoveredEpisodeCount({ total_episodes: 0 }, 12);

    expect(result.next.known_episodes).toBe(12);
    expect(hasNewEpisodes(result.next)).toBe(false);
  });

  it('使用者還沒確認過的舊差額要保留', () => {
    const result = applyDiscoveredEpisodeCount(
      { total_episodes: 12, known_episodes: 10 },
      14
    );

    expect(result.next.known_episodes).toBe(10);
    expect(newEpisodeCount(result.next)).toBe(4);
  });

  it('集數沒變多就不改紀錄', () => {
    const existing = { total_episodes: 12, known_episodes: 12 };
    expect(applyDiscoveredEpisodeCount(existing, 12)).toEqual({
      changed: false,
      next: existing,
    });
  });
});

describe('mergeSeenPlayRecord', () => {
  it('第一次觀看把當前總集數當成已知', () => {
    const merged = mergeSeenPlayRecord(null, {
      title: '示例',
      total_episodes: 12,
      index: 1,
      play_time: 10,
      total_time: 100,
      save_time: 1,
    });

    expect(merged.known_episodes).toBe(12);
    expect(hasNewEpisodes(merged)).toBe(false);
  });

  it('進度存檔不會把 cron 已發現的新集數蓋回去', () => {
    const merged = mergeSeenPlayRecord(
      {
        title: '示例',
        total_episodes: 14,
        known_episodes: 12,
        index: 10,
        play_time: 20,
        total_time: 100,
        save_time: 1,
        cover: 'old.jpg',
      },
      {
        title: '示例',
        total_episodes: 12,
        index: 10,
        play_time: 40,
        total_time: 100,
        save_time: 2,
        cover: '',
      }
    );

    expect(merged.total_episodes).toBe(14);
    expect(merged.known_episodes).toBe(12);
    expect(merged.play_time).toBe(40);
    expect(merged.cover).toBe('old.jpg');
    expect(hasNewEpisodes(merged)).toBe(true);
  });

  it('播放頁載入到新的完整列表後，有新集會消掉', () => {
    const merged = mergeSeenPlayRecord(
      { total_episodes: 14, known_episodes: 12, index: 12 },
      { total_episodes: 14, index: 13, play_time: 5, total_time: 100 }
    );

    expect(merged.known_episodes).toBe(14);
    expect(hasNewEpisodes(merged)).toBe(false);
  });
});

describe('acknowledgeSeenEpisodes', () => {
  it('打開播放頁並看到完整列表後清除有新集', () => {
    const result = acknowledgeSeenEpisodes(
      { total_episodes: 14, known_episodes: 12 },
      14
    );

    expect(result.changed).toBe(true);
    expect(hasNewEpisodes(result.next)).toBe(false);
  });

  it('較短的詳情回應不會把已發現的集數洗掉', () => {
    const existing = { total_episodes: 14, known_episodes: 12 };
    expect(acknowledgeSeenEpisodes(existing, 10)).toEqual({
      changed: false,
      next: existing,
    });
  });

  it('播放頁先看到較新的集數時，總集數與已知一起升高', () => {
    const result = acknowledgeSeenEpisodes(
      { total_episodes: 12, known_episodes: 12 },
      15
    );

    expect(result.next).toEqual({ total_episodes: 15, known_episodes: 15 });
  });
});

describe('mergeSeenFavorite', () => {
  it('保留直播標記與較高的集數', () => {
    const merged = mergeSeenFavorite(
      {
        title: '頻道',
        total_episodes: 8,
        known_episodes: 6,
        origin: 'vod' as const,
        source_name: '甲',
      },
      {
        title: '頻道',
        total_episodes: 6,
        source_name: '甲',
        save_time: 3,
      }
    );

    expect(merged.total_episodes).toBe(8);
    expect(merged.known_episodes).toBe(6);
    expect(merged.origin).toBe('vod');
  });
});
