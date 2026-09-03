import {
  getRegionalMainlandTitles,
  MAX_TITLE_ALIASES,
  mergeAndSortAliases,
  mergeTitleAliasBatch,
  parseTitleAliasList,
  REGIONAL_TITLE_ALIASES,
  sanitizeTitleAlias,
  setCachedCustomTitleAliases,
} from './regional-title-aliases';

beforeEach(() => {
  setCachedCustomTitleAliases([]);
});

describe('regional title aliases', () => {
  it('keeps unique Taiwan titles in the builtin list', () => {
    const tws = REGIONAL_TITLE_ALIASES.map((item) => item.tw);
    expect(new Set(tws).size).toBe(tws.length);
  });

  it('keeps season metadata when replacing a Taiwan title', () => {
    expect(getRegionalMainlandTitles('間諜家家酒 第二季')).toEqual([
      '间谍过家家 第二季',
    ]);
  });

  it('supports a verified secondary mainland title', () => {
    expect(getRegionalMainlandTitles('藥師少女的獨語')).toEqual([
      '药屋少女的呢喃',
      '药师少女的独语',
    ]);
  });

  it('does not guess unknown titles', () => {
    expect(getRegionalMainlandTitles('進擊的巨人')).toEqual([]);
  });

  it.each([
    ['玩命關頭9', '速度与激情9'],
    ['星際效應', '星际穿越'],
    ['全面啟動', '盗梦空间'],
    ['動物方城市2', '疯狂动物城2'],
    ['腦筋急轉彎2', '头脑特工队2'],
    ['惡靈古堡', '生化危机'],
  ])('maps Taiwan title %s to mainland title %s', (tw, cn) => {
    expect(getRegionalMainlandTitles(tw)[0]).toBe(cn);
  });

  // 新增條目：字元轉換無法解決，且簡體名已在豆瓣確認存在
  it.each([
    ['機動戰士鋼彈', '机动战士高达'],
    ['蜘蛛人', '蜘蛛侠'],
    ['鋼鐵人3', '钢铁侠3'],
    ['中華一番', '中华小当家'],
    ['棋靈王', '棋魂'],
    ['魔戒', '指环王'],
    ['魔戒 第二季', '指环王 第二季'],
    ['哈比人', '霍比特人'],
    ['天能', '信条'],
    ['出神入化', '惊天魔盗团'],
    ['水行俠', '海王'],
    ['怕痛的我', '因为太怕痛就全点防御力了'],
    ['東京喰種', '东京食尸鬼'],
    ['屍速列車', '釜山行'],
    ['天外奇蹟', '飞屋环游记'],
    ['料理鼠王', '美食总动员'],
    ['七龍珠超', '龙珠超'],
    ['死亡筆記本', '死亡笔记'],
    ['影子籃球員', '黑子的篮球'],
    ['電馭叛客：邊緣行者', '赛博朋克：邊緣行者'],
    ['福音戰士', '新世纪福音战士'],
    ['新世紀福音戰士', '新世纪福音战士'],
  ])('maps Taiwan title %s to mainland title %s', (tw, cn) => {
    expect(getRegionalMainlandTitles(tw)[0]).toBe(cn);
  });

  it('does not expand 福音戰士 inside the full Taiwan title', () => {
    expect(getRegionalMainlandTitles('新世紀福音戰士')[0]).toBe(
      '新世纪福音战士'
    );
    expect(getRegionalMainlandTitles('新世紀福音戰士')[0]).not.toContain(
      '新世紀新世纪'
    );
  });

  it('does not map 輝夜姬物語 to Kaguya-sama', () => {
    expect(getRegionalMainlandTitles('輝夜姬物語')).toEqual([]);
  });

  it('prefers the longer, more specific alias over the bare term', () => {
    // 「機動戰士鋼彈」比「鋼彈」長，排序後應先命中，不會產生「机动战士高达」以外的結果
    expect(getRegionalMainlandTitles('機動戰士鋼彈')[0]).toBe('机动战士高达');
    expect(getRegionalMainlandTitles('SD鋼彈')[0]).toBe('SD高达');
  });
});

describe('mergeAndSortAliases', () => {
  it('lets custom aliases override builtin ones with the same tw', () => {
    const merged = mergeAndSortAliases(
      [{ tw: '鋼彈', cn: '钢弹自定义' }],
      REGIONAL_TITLE_ALIASES
    );
    expect(merged.find((item) => item.tw === '鋼彈')?.cn).toBe('钢弹自定义');
    expect(
      getRegionalMainlandTitles('SD鋼彈', [{ tw: '鋼彈', cn: '钢弹自定义' }])[0]
    ).toBe('SD钢弹自定义');
  });

  it('keeps season metadata when a custom alias replaces the title', () => {
    expect(
      getRegionalMainlandTitles('魔戒 第二季', [{ tw: '魔戒', cn: '指环王' }])
    ).toEqual(['指环王 第二季']);
  });

  it('prefers the longer custom alias over a shorter builtin term', () => {
    const titles = getRegionalMainlandTitles('機動戰士鋼彈特別篇', [
      { tw: '機動戰士鋼彈特別篇', cn: '机动战士高达特别篇' },
    ]);
    expect(titles[0]).toBe('机动战士高达特别篇');
  });
});

describe('sanitizeTitleAlias', () => {
  it('rejects short, empty, or colon-containing titles', () => {
    expect(sanitizeTitleAlias({ tw: '人', cn: '指环王' })).toBeNull();
    expect(sanitizeTitleAlias({ tw: '魔戒', cn: '' })).toBeNull();
    expect(sanitizeTitleAlias({ tw: '魔:戒', cn: '指环王' })).toBeNull();
  });

  it('trims valid pairs', () => {
    expect(sanitizeTitleAlias({ tw: ' 魔戒 ', cn: ' 指环王 ' })).toEqual({
      tw: '魔戒',
      cn: '指环王',
    });
  });
});

describe('parseTitleAliasList', () => {
  it('accepts a raw array, a wrapped object, or a single pair', () => {
    expect(
      parseTitleAliasList([
        { tw: '魔戒', cn: '指环王' },
        { tw: '天能', cn: '信条' },
      ]).aliases
    ).toEqual([
      { tw: '魔戒', cn: '指环王' },
      { tw: '天能', cn: '信条' },
    ]);
    expect(
      parseTitleAliasList({
        aliases: [{ tw: '出神入化', cn: '惊天魔盗团' }],
      }).aliases
    ).toEqual([{ tw: '出神入化', cn: '惊天魔盗团' }]);
    expect(parseTitleAliasList({ tw: '水行俠', cn: '海王' }).aliases).toEqual([
      { tw: '水行俠', cn: '海王' },
    ]);
  });

  it('skips invalid, short, colon-containing, and duplicate tw values', () => {
    const parsed = parseTitleAliasList([
      { tw: '魔戒', cn: '指环王' },
      { tw: '魔戒', cn: '指环王重覆' },
      { tw: '人', cn: '指环王' },
      { tw: '魔:戒', cn: '指环王' },
      null,
      'nope',
    ]);
    expect(parsed.aliases).toEqual([{ tw: '魔戒', cn: '指环王' }]);
    expect(parsed.skipped).toBe(5);
  });
});

describe('mergeTitleAliasBatch', () => {
  it('merges by tw, updates existing, and appends new rows', () => {
    const result = mergeTitleAliasBatch(
      [{ tw: '魔戒', cn: '旧名' }],
      [
        { tw: '魔戒', cn: '指环王' },
        { tw: '天能', cn: '信条' },
      ],
      'merge'
    );
    expect(result).toEqual({
      aliases: [
        { tw: '魔戒', cn: '指环王' },
        { tw: '天能', cn: '信条' },
      ],
      added: 1,
      updated: 1,
      skipped: 0,
    });
  });

  it('replace overwrites the custom list and caps at the maximum', () => {
    const incoming = Array.from({ length: MAX_TITLE_ALIASES + 3 }, (_, i) => ({
      tw: `台名${String(i).padStart(3, '0')}`,
      cn: `陆名${String(i).padStart(3, '0')}`,
    }));
    const result = mergeTitleAliasBatch(
      [{ tw: '舊的', cn: '应被覆盖' }],
      incoming,
      'replace'
    );
    expect(result.aliases).toHaveLength(MAX_TITLE_ALIASES);
    expect(result.added).toBe(MAX_TITLE_ALIASES);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.aliases[0]).toEqual(incoming[0]);
    expect(result.aliases.some((item) => item.tw === '舊的')).toBe(false);
  });

  it('merge skips new tw values once the cap is reached', () => {
    const current = Array.from({ length: MAX_TITLE_ALIASES }, (_, i) => ({
      tw: `舊${String(i).padStart(3, '0')}`,
      cn: `陆${String(i).padStart(3, '0')}`,
    }));
    const result = mergeTitleAliasBatch(
      current,
      [
        { tw: '舊000', cn: '覆盖' },
        { tw: '全新片名', cn: '装不下' },
      ],
      'merge'
    );
    expect(result.aliases).toHaveLength(MAX_TITLE_ALIASES);
    expect(result.updated).toBe(1);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.aliases.find((item) => item.tw === '舊000')?.cn).toBe('覆盖');
  });
});
