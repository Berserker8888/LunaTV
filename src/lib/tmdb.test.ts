import { __clearTmdbCache, lookupTmdb } from './tmdb';

describe('lookupTmdb', () => {
  beforeEach(() => {
    __clearTmdbCache();
  });

  it('對上作品後回繁中資料，並在快取有效時不再打 TMDB', async () => {
    const fetchJson = jest.fn(async (url: string) => {
      if (url.includes('/search/multi')) {
        return {
          results: [
            {
              id: 1429,
              media_type: 'tv',
              name: '進擊的巨人',
              original_name: 'Shingeki no Kyojin',
              first_air_date: '2013-04-07',
              vote_count: 100,
            },
          ],
        };
      }
      return {
        id: 1429,
        name: '進擊的巨人',
        overview: '人類與巨人的戰鬥。',
        first_air_date: '2013-04-07',
        vote_average: 8.6,
        genres: [{ name: '動畫' }],
        credits: { cast: [], crew: [] },
      };
    });

    const query = {
      title: '進擊的巨人',
      year: '2013',
      episodes: 25,
      typeName: '動漫',
    };
    const match = await lookupTmdb(query, {
      apiKey: 'test-key',
      fetchJson,
      now: 1,
    });
    const cached = await lookupTmdb(query, {
      apiKey: 'test-key',
      fetchJson,
      now: 2,
    });

    expect(match?.id).toBe(1429);
    expect(match?.overview).toContain('人類');
    expect(cached).toEqual(match);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('沒有金鑰時不對外查詢', async () => {
    const fetchJson = jest.fn();
    await expect(
      lookupTmdb({ title: '進擊的巨人' }, { apiKey: '', fetchJson, now: 1 })
    ).resolves.toBeNull();
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
