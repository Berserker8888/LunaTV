export interface RegionalTitleAlias {
  tw: string;
  cn: string;
  alternatives?: string[];
}

export const MAX_TITLE_ALIASES = 200;
const TITLE_ALIAS_MAX_LENGTH = 80;

function hasForbiddenAliasChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 58 || code < 32) return true;
  }
  return false;
}

let cachedCustomAliases: RegionalTitleAlias[] = [];

export function setCachedCustomTitleAliases(
  aliases: RegionalTitleAlias[] | undefined
): void {
  cachedCustomAliases = Array.isArray(aliases) ? aliases : [];
}

export function getRuntimeCustomAliases(): RegionalTitleAlias[] {
  if (typeof window !== 'undefined') {
    const fromWindow = window.RUNTIME_CONFIG?.TITLE_ALIASES;
    if (Array.isArray(fromWindow)) return fromWindow;
  }
  return cachedCustomAliases;
}

export function sanitizeTitleAlias(
  raw: unknown
): { tw: string; cn: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { tw?: unknown; cn?: unknown };
  const tw = typeof record.tw === 'string' ? record.tw.trim() : '';
  const cn = typeof record.cn === 'string' ? record.cn.trim() : '';
  if (tw.length < 2 || cn.length < 2) return null;
  if (
    tw.length > TITLE_ALIAS_MAX_LENGTH ||
    cn.length > TITLE_ALIAS_MAX_LENGTH
  ) {
    return null;
  }
  if (hasForbiddenAliasChar(tw) || hasForbiddenAliasChar(cn)) {
    return null;
  }
  return { tw, cn };
}

export type TitleAliasPair = { tw: string; cn: string };
export type TitleAliasImportMode = 'merge' | 'replace';

function collectAliasList(list: unknown[]): {
  aliases: TitleAliasPair[];
  skipped: number;
} {
  const seen = new Set<string>();
  const aliases: TitleAliasPair[] = [];
  let skipped = 0;
  for (const item of list) {
    const alias = sanitizeTitleAlias(item);
    if (!alias || seen.has(alias.tw)) {
      skipped += 1;
      continue;
    }
    seen.add(alias.tw);
    aliases.push(alias);
  }
  return { aliases, skipped };
}

/** 接受陣列、單筆物件，或 `{ aliases: [...] }`。無效／重複的 tw 會略過。 */
export function parseTitleAliasList(raw: unknown): {
  aliases: TitleAliasPair[];
  skipped: number;
} {
  if (Array.isArray(raw)) return collectAliasList(raw);
  if (raw && typeof raw === 'object') {
    const record = raw as { aliases?: unknown };
    if (Array.isArray(record.aliases)) {
      return collectAliasList(record.aliases);
    }
    const single = sanitizeTitleAlias(raw);
    if (single) return { aliases: [single], skipped: 0 };
  }
  return { aliases: [], skipped: 0 };
}

/**
 * 自訂別名批次合併。replace 會整份換成匯入結果（仍受 200 筆上限）。
 * merge 以 tw 覆蓋舊值；超過上限的新 tw 計入 skipped，不中斷已套用的筆數。
 */
export function mergeTitleAliasBatch(
  current: TitleAliasPair[],
  incoming: TitleAliasPair[],
  mode: TitleAliasImportMode = 'merge'
): {
  aliases: TitleAliasPair[];
  added: number;
  updated: number;
  skipped: number;
} {
  if (mode === 'replace') {
    const aliases = incoming.slice(0, MAX_TITLE_ALIASES);
    return {
      aliases,
      added: aliases.length,
      updated: 0,
      skipped: incoming.length - aliases.length,
    };
  }

  const byTw = new Map<string, TitleAliasPair>();
  for (const item of current) {
    if (!item.tw) continue;
    byTw.set(item.tw, { tw: item.tw, cn: item.cn });
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of incoming) {
    if (byTw.has(item.tw)) {
      byTw.set(item.tw, item);
      updated += 1;
      continue;
    }
    if (byTw.size >= MAX_TITLE_ALIASES) {
      skipped += 1;
      continue;
    }
    byTw.set(item.tw, item);
    added += 1;
  }

  return {
    aliases: Array.from(byTw.values()),
    added,
    updated,
    skipped,
  };
}

/**
 * Verified Taiwan-to-mainland title differences that cannot be solved by
 * character conversion alone. Keep this list deliberately curated: a wrong
 * alias is worse than a missed fallback when searching third-party CMS data.
 */
export const REGIONAL_TITLE_ALIASES: RegionalTitleAlias[] = [
  { tw: '間諜家家酒', cn: '间谍过家家' },
  { tw: '航海王', cn: '海贼王' },
  { tw: '神隱少女', cn: '千与千寻' },
  { tw: '魔法公主', cn: '幽灵公主' },
  { tw: '霍爾的移動城堡', cn: '哈尔的移动城堡' },
  { tw: '借物少女艾莉緹', cn: '借东西的小人阿莉埃蒂' },
  {
    tw: '藥師少女的獨語',
    cn: '药屋少女的呢喃',
    alternatives: ['药师少女的独语'],
  },
  { tw: '玩命關頭', cn: '速度与激情' },
  { tw: '星際效應', cn: '星际穿越' },
  { tw: '全面啟動', cn: '盗梦空间' },
  { tw: '動物方城市', cn: '疯狂动物城' },
  { tw: '腦筋急轉彎', cn: '头脑特工队' },
  { tw: '惡靈古堡', cn: '生化危机' },
  { tw: '金牌特務', cn: '王牌特工' },
  { tw: '駭客任務', cn: '黑客帝国' },
  { tw: '神鬼奇航', cn: '加勒比海盗' },
  { tw: '明日邊界', cn: '明日边缘' },
  { tw: '刺激1995', cn: '肖申克的救赎' },
  { tw: '三個傻瓜', cn: '三傻大闹宝莱坞' },
  { tw: '我和我的冠軍女兒', cn: '摔跤吧爸爸' },
  { tw: '可可夜總會', cn: '寻梦环游记', alternatives: ['coco夜总会'] },
  { tw: 'COCO夜總會', cn: '寻梦环游记' },
  { tw: '鐵達尼號', cn: '泰坦尼克号' },
  { tw: '捍衛任務', cn: '疾速追杀' },
  { tw: '鏈鋸人', cn: '电锯人' },
  { tw: '冰與火之歌', cn: '权力的游戏' },
  // 以下每筆都先確認兩件事才收錄：
  // (1) 繁簡轉換無法解決（鋼彈→钢弹、蜘蛛人→蜘蛛人、棋靈王→棋灵王…）
  // (2) 簡體名在豆瓣確實查得到對應作品
  { tw: '機動戰士鋼彈', cn: '机动战士高达' },
  { tw: '鋼彈', cn: '高达' },
  { tw: '蜘蛛人', cn: '蜘蛛侠' },
  { tw: '鋼鐵人', cn: '钢铁侠' },
  { tw: '中華一番', cn: '中华小当家' },
  { tw: '棋靈王', cn: '棋魂' },
  // 電影：繁簡轉換對不上的台譯
  { tw: '魔戒', cn: '指环王' },
  { tw: '哈比人', cn: '霍比特人' },
  { tw: '天能', cn: '信条' },
  { tw: '出神入化', cn: '惊天魔盗团' },
  { tw: '水行俠', cn: '海王' },
  { tw: '神鬼認證', cn: '谍影重重' },
  { tw: '星際大戰', cn: '星球大战' },
  { tw: '星際爭霸戰', cn: '星际迷航' },
  { tw: '不可能的任務', cn: '碟中谍' },
  { tw: '寄生上流', cn: '寄生虫' },
  { tw: '樂來越愛你', cn: '爱乐之城' },
  { tw: '大英雄天團', cn: '超能陆战队' },
  { tw: '星際異攻隊', cn: '银河护卫队' },
  { tw: '神力女超人', cn: '神奇女侠' },
  { tw: '猛毒', cn: '毒液' },
  { tw: '捍衛戰士', cn: '壮志凌云' },
  { tw: '神鬼傳奇', cn: '木乃伊' },
  { tw: '火線追緝令', cn: '七宗罪' },
  { tw: '美麗境界', cn: '美丽心灵' },
  { tw: '神鬼交鋒', cn: '猫鼠游戏' },
  { tw: '怪獸與牠們的產地', cn: '神奇动物在哪里' },
  { tw: '終極警探', cn: '虎胆龙威' },
  { tw: 'MIB星際戰警', cn: '黑衣人' },
  { tw: '魔鬼終結者', cn: '终结者' },
  { tw: '星艦戰將', cn: '星河战队' },
  { tw: '瘋狂麥斯', cn: '疯狂的麦克斯' },
  { tw: '靈魂急轉彎', cn: '心灵奇旅' },
  { tw: '路卡的夏天', cn: '夏日友晴天' },
  { tw: '青春養成記', cn: '青春变形记' },
  { tw: '元素方城市', cn: '疯狂元素城' },
  { tw: '最黑暗的時刻', cn: '至暗时刻' },
  { tw: '登月先鋒', cn: '登月第一人' },
  { tw: '曼哈頓奇緣', cn: '魔法奇缘' },
  { tw: '長髮公主', cn: '魔发奇缘' },
  { tw: '敦克爾克大撤退', cn: '敦刻尔克' },
  // 動漫：台譯／陸譯用字完全不同
  {
    tw: '怕痛的我，把防禦力點滿就對了',
    cn: '因为太怕痛就全点防御力了',
  },
  { tw: '怕痛的我', cn: '因为太怕痛就全点防御力了' },
  { tw: '東京喰種', cn: '东京食尸鬼' },
  { tw: '輕音部', cn: '轻音少女' },
  { tw: '百變小櫻', cn: '魔卡少女樱' },
  { tw: '庫洛魔法使', cn: '魔卡少女樱' },
  { tw: '小叮噹', cn: '哆啦A梦' },
  { tw: '機器貓', cn: '哆啦A梦' },
  { tw: '數碼暴龍', cn: '数码宝贝' },
  { tw: '神奇寶貝', cn: '精灵宝可梦' },
  { tw: '寵物小精靈', cn: '精灵宝可梦' },
  { tw: '閃電霹靂車', cn: '高智能方程式' },
  { tw: '爆走兄弟', cn: '四驱兄弟' },
  { tw: '叛逆的魯魯修', cn: '反叛的鲁路修' },
  { tw: '輝夜姬想讓人告白', cn: '辉夜大小姐想让我告白' },
  { tw: '新世紀福音戰士', cn: '新世纪福音战士' },
  { tw: '福音戰士', cn: '新世纪福音战士' },
  { tw: '心之谷', cn: '侧耳倾听' },
  { tw: '七龍珠', cn: '龙珠' },
  { tw: '死亡筆記本', cn: '死亡笔记' },
  { tw: '影子籃球員', cn: '黑子的篮球' },
  { tw: '電馭叛客', cn: '赛博朋克' },
  { tw: '瑪利歐', cn: '马里奥' },
  { tw: '薩爾達', cn: '塞尔达' },
  { tw: '太空戰士', cn: '最终幻想' },
  { tw: '音速小子', cn: '刺猬索尼克' },
  // 皮克斯／迪士尼：台譯與「××总动员」陸名對不上
  { tw: '天外奇蹟', cn: '飞屋环游记' },
  { tw: '料理鼠王', cn: '美食总动员' },
  { tw: '超人特攻隊', cn: '超人总动员' },
  { tw: '瓦力', cn: '机器人总动员' },
  { tw: '小小兵', cn: '小黄人' },
  // 好萊塢／韓片：台譯用字完全不同
  { tw: '達文西密碼', cn: '达芬奇密码' },
  { tw: '絕地救援', cn: '火星救援' },
  { tw: '屍速列車', cn: '釜山行' },
  { tw: '浴血任務', cn: '敢死队' },
  { tw: '終極戰士', cn: '铁血战士' },
  { tw: '靈異第六感', cn: '第六感' },
  { tw: '鬼店', cn: '闪灵' },
  { tw: '大法師', cn: '驱魔人' },
  { tw: '野蠻遊戲', cn: '勇敢者游戏' },
  { tw: '哥吉拉', cn: '哥斯拉' },
  { tw: '明天過後', cn: '后天' },
  { tw: '變種特攻', cn: 'X战警' },
  { tw: '自殺突擊隊', cn: '自杀小队' },
  { tw: '變形俠醫', cn: '绿巨人' },
  { tw: '地獄怪客', cn: '地狱男爵' },
];

/**
 * 自訂 tw 覆蓋同名內建條目，再依 tw 長度由長到短排。
 * 長詞優先才能讓「機動戰士鋼彈」先於「鋼彈」命中。
 */
export function mergeAndSortAliases(
  custom: RegionalTitleAlias[] = [],
  builtin: RegionalTitleAlias[] = REGIONAL_TITLE_ALIASES
): RegionalTitleAlias[] {
  const byTw = new Map<string, RegionalTitleAlias>();
  for (const alias of builtin) {
    if (alias.tw) byTw.set(alias.tw, alias);
  }
  for (const alias of custom) {
    if (!alias.tw) continue;
    byTw.set(alias.tw, {
      tw: alias.tw,
      cn: alias.cn,
      alternatives: alias.alternatives,
    });
  }
  return Array.from(byTw.values()).sort((a, b) => b.tw.length - a.tw.length);
}

export function getRegionalMainlandTitles(
  query: string,
  custom: RegionalTitleAlias[] = getRuntimeCustomAliases()
): string[] {
  for (const alias of mergeAndSortAliases(custom)) {
    if (!query.includes(alias.tw)) continue;
    const replaceTitle = (title: string) => query.replace(alias.tw, title);
    return [alias.cn, ...(alias.alternatives || [])].map(replaceTitle);
  }
  return [];
}
