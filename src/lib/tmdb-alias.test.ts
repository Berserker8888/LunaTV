import {
  applyTmdbAuth,
  buildTmdbAlternativeTitlesUrl,
  buildTmdbSearchUrl,
  buildTmdbTranslationsUrl,
  extractTmdbTitleAliases,
  hasTmdbSearchHits,
  pickTmdbCandidateIds,
} from './tmdb-alias';

describe('buildTmdbSearchUrl', () => {
  it('組出 movie／tv 搜尋 URL，預設 zh-TW', () => {
    expect(buildTmdbSearchUrl('movie', '玩命關頭')).toBe(
      'https://api.themoviedb.org/3/search/movie?query=%E7%8E%A9%E5%91%BD%E9%97%9C%E9%A0%AD&language=zh-TW&page=1&include_adult=false'
    );
    expect(buildTmdbSearchUrl('tv', '玩命關頭')).toContain('/search/tv?');
  });
});

describe('buildTmdbAlternativeTitlesUrl', () => {
  it('電影與劇集路徑正確', () => {
    expect(buildTmdbAlternativeTitlesUrl('movie', 123)).toBe(
      'https://api.themoviedb.org/3/movie/123/alternative_titles'
    );
    expect(buildTmdbAlternativeTitlesUrl('tv', 456)).toBe(
      'https://api.themoviedb.org/3/tv/456/alternative_titles'
    );
  });
});

describe('buildTmdbTranslationsUrl', () => {
  it('路徑正確', () => {
    expect(buildTmdbTranslationsUrl('tv', 456)).toBe(
      'https://api.themoviedb.org/3/tv/456/translations'
    );
  });
});

describe('applyTmdbAuth', () => {
  const url = 'https://api.themoviedb.org/3/search/movie?query=x';

  it('v3 金鑰放查詢參數', () => {
    const { url: authed, headers } = applyTmdbAuth(url, 'abc123');
    expect(authed).toContain('api_key=abc123');
    expect(headers.Authorization).toBeUndefined();
  });

  it('v4 權杖（eyJ 開頭）走 Bearer 標頭，不污染 URL', () => {
    const { url: authed, headers } = applyTmdbAuth(url, 'eyJhbGciOiJIUzI1NiJ9');
    expect(authed).toBe(url);
    expect(headers.Authorization).toBe('Bearer eyJhbGciOiJIUzI1NiJ9');
  });
});

describe('pickTmdbCandidateIds', () => {
  it('movie／tv 各取首筆', () => {
    expect(
      pickTmdbCandidateIds(
        { results: [{ id: 1 }, { id: 2 }] },
        { results: [{ id: 9 }] }
      )
    ).toEqual([
      { mediaType: 'movie', tmdbId: 1 },
      { mediaType: 'tv', tmdbId: 9 },
    ]);
  });

  it('無效 id 略過，兩邊都空就回空陣列', () => {
    expect(
      pickTmdbCandidateIds({ results: [{ id: 0 }] }, { results: [{ id: -3 }] })
    ).toEqual([]);
    expect(pickTmdbCandidateIds({}, {})).toEqual([]);
  });
});

describe('extractTmdbTitleAliases', () => {
  const altPayload = (titles: { iso_3166_1?: string; title?: string }[]) => ({
    titles,
  });
  const transPayload = (
    translations: {
      iso_3166_1?: string;
      iso_639_1?: string;
      data?: { title?: string };
    }[]
  ) => ({ translations });

  it('CN 優先於 TW／HK／其他，電影用 titles key', () => {
    const aliases = extractTmdbTitleAliases(
      [
        altPayload([
          { iso_3166_1: 'US', title: 'Fast X' },
          { iso_3166_1: 'HK', title: '狂野時速10' },
          { iso_3166_1: 'TW', title: '玩命關頭10' },
          { iso_3166_1: 'CN', title: '速度与激情10' },
        ]),
      ],
      [],
      '玩命關頭10'
    );
    // TW 譯名與原查詢轉換後相同會被濾掉
    expect(aliases[0]).toBe('速度与激情10');
    expect(aliases).toContain('狂野时速10');
  });

  it('劇集端點用 results key 也吃得到', () => {
    const aliases = extractTmdbTitleAliases(
      [{ results: [{ iso_3166_1: 'CN', title: '间谍过家家' }] }],
      [],
      '間諜家家酒'
    );
    expect(aliases).toEqual(['间谍过家家']);
  });

  it('動漫：translations 的 zh-CN 官方中文名優先於上映別名', () => {
    const aliases = extractTmdbTitleAliases(
      [
        altPayload([
          { iso_3166_1: 'CN', title: '间谍过家家' },
          { iso_3166_1: 'JP', title: 'SPY×FAMILY' },
        ]),
      ],
      [
        transPayload([
          { iso_3166_1: 'CN', iso_639_1: 'zh', data: { title: '间谍过家家' } },
          { iso_3166_1: 'TW', iso_639_1: 'zh', data: { title: '間諜家家酒' } },
          {
            iso_3166_1: 'US',
            iso_639_1: 'en',
            data: { title: 'SPY x FAMILY' },
          },
        ]),
      ],
      '間諜家家酒'
    );
    // TW 官方名與查詢相同被濾掉；CN 官方名（translations）排第一
    expect(aliases[0]).toBe('间谍过家家');
    // 非中文語系略過
    expect(aliases).not.toContain('SPY x FAMILY');
  });

  it('非中日韓標題略過，與查詢相同者略過', () => {
    const aliases = extractTmdbTitleAliases(
      [
        altPayload([
          { iso_3166_1: 'US', title: 'Spy x Family' },
          { iso_3166_1: 'CN', title: '间谍过家家' },
          { iso_3166_1: 'CN', title: '間諜家家酒' }, // 轉簡後與查詢相同
        ]),
      ],
      [],
      '間諜家家酒'
    );
    expect(aliases).toEqual(['间谍过家家']);
  });

  it('重複標題去重，limit 生效', () => {
    const aliases = extractTmdbTitleAliases(
      [
        altPayload([
          { iso_3166_1: 'CN', title: '速度与激情10' },
          { iso_3166_1: 'HK', title: '速度與激情10' }, // 轉簡後重複
          { iso_3166_1: 'CN', title: '速激10' },
          { iso_3166_1: 'CN', title: '狂野时速10' },
        ]),
      ],
      [],
      '玩命關頭10',
      2
    );
    expect(aliases).toEqual(['速度与激情10', '速激10']);
  });

  it('空回應不爆炸', () => {
    expect(extractTmdbTitleAliases([], [], '玩命關頭')).toEqual([]);
    expect(extractTmdbTitleAliases([{}], [{}], '玩命關頭')).toEqual([]);
  });
});

describe('hasTmdbSearchHits', () => {
  it('有結果才算打中', () => {
    expect(hasTmdbSearchHits({ results: [{ id: 1 }] })).toBe(true);
    expect(hasTmdbSearchHits({ results: [] })).toBe(false);
    expect(hasTmdbSearchHits({})).toBe(false);
  });
});
