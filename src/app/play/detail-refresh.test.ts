import type { SearchResult } from '@/lib/types';

import { runRefreshEpisodesIfNeeded } from './detail-refresh';

type RefreshOptions = Parameters<typeof runRefreshEpisodesIfNeeded>[0];

const fakeDetail = {
  id: 'vid-1',
  title: '劇名',
  poster: '',
  episodes: [],
  episodes_titles: [],
  source: 'src-a',
  source_name: '測試源',
  year: '',
} satisfies SearchResult;

function baseOptions(overrides: Partial<RefreshOptions> = {}): RefreshOptions {
  return {
    source: 'src-a',
    id: 'vid-1',
    getCurrentSource: () => 'src-a',
    getCurrentId: () => 'vid-1',
    currentIndex: 0,
    currentEpisodeCount: 10,
    inFlight: false,
    setInFlight: jest.fn(),
    fetchFreshDetail: jest.fn(async () => fakeDetail),
    apply: jest.fn(() => ({
      applied: true,
      episodeCountIncreased: true,
      nextEpisodeCount: 12,
      episodeIndex: 0,
    })),
    notify: jest.fn(),
    ...overrides,
  };
}

describe('runRefreshEpisodesIfNeeded 中途切源', () => {
  it('抓取期間切換片源：丟棄過期結果，不套用', async () => {
    let currentSource: string | null = 'src-a';
    const fetchFreshDetail = jest.fn(async () => {
      // 模擬抓取完成前使用者已切到 src-b
      currentSource = 'src-b';
      return fakeDetail;
    });
    const apply = jest.fn();

    const result = await runRefreshEpisodesIfNeeded(
      baseOptions({
        fetchFreshDetail,
        apply,
        getCurrentSource: () => currentSource,
      })
    );

    expect(fetchFreshDetail).toHaveBeenCalledWith('src-a', 'vid-1');
    expect(apply).not.toHaveBeenCalled();
    expect(result.updated).toBe(false);
  });

  it('抓取期間未切源：正常套用', async () => {
    const apply = jest.fn(() => ({
      applied: true,
      episodeCountIncreased: true,
      nextEpisodeCount: 12,
      episodeIndex: 0,
    }));

    const result = await runRefreshEpisodesIfNeeded(baseOptions({ apply }));

    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(true);
  });

  it('沒有提供 getter 時維持舊行為（不誤判）', async () => {
    const apply = jest.fn(() => ({
      applied: true,
      episodeCountIncreased: true,
      nextEpisodeCount: 12,
      episodeIndex: 0,
    }));

    const result = await runRefreshEpisodesIfNeeded(
      baseOptions({
        apply,
        getCurrentSource: undefined,
        getCurrentId: undefined,
      })
    );
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(true);
  });
});
