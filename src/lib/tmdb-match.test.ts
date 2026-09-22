import { setCachedCustomTitleAliases } from './regional-title-aliases';
import { convertT2S } from './s2t';
import {
  collectTmdbSearchQueries,
  extractSeasonNumber,
  mapTmdbDetail,
  pickTmdbCandidate,
  preferTmdbMediaType,
  scoreTmdbCandidate,
  type TmdbSearchCandidate,
} from './tmdb-match';

function candidate(
  overrides: Partial<TmdbSearchCandidate> = {}
): TmdbSearchCandidate {
  return {
    id: 1,
    mediaType: 'tv',
    title: '進擊的巨人',
    originalTitle: 'Shingeki no Kyojin',
    date: '2013-04-07',
    popularity: 20,
    voteCount: 100,
    ...overrides,
  };
}

describe('extractSeasonNumber', () => {
  it('讀出中文與英文季數', () => {
    expect(extractSeasonNumber('進擊的巨人 第二季')).toBe(2);
    expect(extractSeasonNumber('第十一季')).toBe(11);
    expect(extractSeasonNumber('Season 3')).toBe(3);
    expect(extractSeasonNumber('沒有季數')).toBeNull();
  });
});

describe('preferTmdbMediaType', () => {
  it('簡體分類會先轉成繁中再判斷電影或劇集', () => {
    expect(
      preferTmdbMediaType({
        typeName: convertT2S('電影'),
        episodes: 1,
      })
    ).toBe('movie');
    expect(
      preferTmdbMediaType({
        typeName: convertT2S('電視劇'),
        episodes: 12,
      })
    ).toBe('tv');
  });
});

describe('pickTmdbCandidate', () => {
  beforeEach(() => {
    setCachedCustomTitleAliases([]);
  });

  it('片名與年份對上才採用', () => {
    const picked = pickTmdbCandidate([candidate()], {
      title: '進擊的巨人',
      year: '2013',
      episodes: 25,
      typeName: '動漫',
    });
    expect(picked?.id).toBe(1);
  });

  it('同年名但年份差太多的重啟作不採用', () => {
    const picked = pickTmdbCandidate(
      [candidate({ date: '2022-01-01', id: 9 })],
      {
        title: '進擊的巨人',
        year: '2013',
        episodes: 25,
        typeName: '動漫',
      }
    );
    expect(picked).toBeNull();
    expect(
      scoreTmdbCandidate(candidate({ date: '2022-01-01' }), {
        title: '進擊的巨人',
        year: '2013',
        episodes: 25,
      })
    ).toBeLessThan(90);
  });

  it('繁簡片名可以對上', () => {
    const picked = pickTmdbCandidate(
      [candidate({ title: convertT2S('進擊的巨人') })],
      { title: '進擊的巨人', year: '2013', episodes: 25 }
    );
    expect(picked?.id).toBe(1);
  });
});

describe('collectTmdbSearchQueries', () => {
  beforeEach(() => {
    setCachedCustomTitleAliases([]);
  });

  it('台譯片名會多帶一條陸源片名', () => {
    const queries = collectTmdbSearchQueries('魔戒');
    expect(queries[0]).toBe('魔戒');
    expect(queries.length).toBeGreaterThan(1);
  });
});

describe('mapTmdbDetail', () => {
  it('把作品資料收成播放頁要用的繁中欄位', () => {
    const match = mapTmdbDetail(
      {
        id: 1429,
        name: '進擊的巨人',
        original_name: 'Shingeki no Kyojin',
        overview: '人類與巨人的戰鬥。',
        first_air_date: '2013-04-07',
        vote_average: 8.66,
        genres: [{ name: '動畫' }, { name: '動作' }],
        created_by: [{ name: '諫山創' }],
        poster_path: '/poster.jpg',
        backdrop_path: '/back.jpg',
        credits: {
          cast: [
            { name: '梶裕貴', character: '艾倫' },
            { name: '石川由依', character: '米卡莎' },
          ],
        },
      },
      'tv',
      '第二季的故事。'
    );

    expect(match).toEqual(
      expect.objectContaining({
        id: 1429,
        mediaType: 'tv',
        title: '進擊的巨人',
        overview: '第二季的故事。',
        year: '2013',
        voteAverage: 8.7,
        director: '諫山創',
        posterUrl: 'https://image.tmdb.org/t/p/w342/poster.jpg',
        tmdbUrl: 'https://www.themoviedb.org/tv/1429?language=zh-TW',
      })
    );
    expect(match?.cast[0]).toEqual({ name: '梶裕貴', character: '艾倫' });
    expect(match?.genres).toEqual(['動畫', '動作']);
  });
});
