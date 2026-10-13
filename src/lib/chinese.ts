import { getTaiwanDisplayTitle } from './regional-title-aliases';
import { convertS2T, convertT2S } from './s2t';

// This module provides Traditional Chinese conversion utilities for search

const CHINESE_TO_ARABIC: { [key: string]: string } = {
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10',
};

const ARABIC_TO_CHINESE = [
  '',
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
];

/** 只轉全形英數與全形空白（保留全形標點——CMS 片名常含全形標點） */
function normalizeFullwidthAlnum(text: string): string {
  return text
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\u3000/g, ' ');
}

/**
 * 只把夾在漢字中間的「の」當成助詞轉成「的」。
 * 不碰 は／を／と：那些字常是假名單詞的一部分，
 * 「はたらく細胞」若刪 は 會變成「たらく細胞」，「となりのトトロ」的 と 也不是「和」。
 */
export function convertJapaneseParticlesForSearch(text: string): string {
  return text.replace(/(?<=[\u3400-\u9fff])の(?=[\u3400-\u9fff])/g, '的');
}

export function toSearchSimplified(text: string): string {
  // 這裡原本在轉換器之後逐字補了 36 個字（進→进、擊→击……），看起來像是
  // 不信任轉換器而逐一打補丁。以 38 個真實片名語料實測，其中 35 個轉換器
  // 本來就處理正確，移除後輸出完全一致，因此只保留唯一必要的那一個。
  //
  // 迴／回 在繁體是兩個不同的字（輪迴、迴轉），簡體才合併為「回」，
  // 轉換器不動它是正確行為，故仍需補上——少了這個，「咒術迴戰」會轉成
  // 「咒术迴战」而搜不到任何陸源。此行為由 s2t-real.test.ts 看守。
  return (
    convertT2S(normalizeFullwidthAlnum(text))
      .replace(/迴/g, '回')
      // 日文新字體「撃」不是台灣繁體「擊」，OpenCC 不會轉成陸源「击」
      .replace(/撃/g, '击')
  );
}

export function generateNumberVariant(query: string): string | null {
  const chinesePattern = /第([一二三四五六七八九十])(季|部|集|期)/;
  const chineseMatch = chinesePattern.exec(query);
  if (chineseMatch) {
    const chineseNum = chineseMatch[1];
    const arabicNum = CHINESE_TO_ARABIC[chineseNum];
    if (arabicNum) {
      const base = query.replace(chineseMatch[0], '').trim();
      if (base) {
        return `${base}${arabicNum}`;
      }
    }
  }

  const arabicPattern = /第(\d+)(季|部|集|期)/;
  const arabicMatch = arabicPattern.exec(query);
  if (arabicMatch) {
    const num = parseInt(arabicMatch[1]);
    const suffix = arabicMatch[2];
    if (num >= 1 && num <= 10) {
      const chineseNum = ARABIC_TO_CHINESE[num];
      return query.replace(arabicMatch[0], `第${chineseNum}${suffix}`);
    }
  }

  const endNumberMatch = query.match(/^(.+?)(\d+)$/);
  if (endNumberMatch) {
    const base = endNumberMatch[1].trim();
    const num = parseInt(endNumberMatch[2]);
    if (num >= 1 && num <= 10 && base) {
      const chineseNum = ARABIC_TO_CHINESE[num];
      return `${base}第${chineseNum}季`;
    }
  }

  return null;
}

function generatePunctuationVariant(query: string): string | null {
  if (query.includes('：')) {
    return query.replace(/：/g, ' ');
  }
  if (query.includes(':')) {
    return query.replace(/:/g, ' ');
  }
  if (query.includes('《') || query.includes('》')) {
    return query.replace(/[《》]/g, '');
  }
  if (/[×✕✖～~・·]/.test(query)) {
    return query
      .replace(/[×✕✖～~・·]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return null;
}

const SEARCH_SEPARATOR_PATTERN =
  /[\s~～\-－—–・·,，.。:：!！?？《》「」『』【】（）()_、/\\|×✕✖☆★♪♥♡]+/g;
const SEARCH_CJK_PATTERN = /[\u3400-\u9fff]/;
const SEARCH_KANA_PATTERN = /[\u3040-\u30ff]/;

/** 陸源搜尋只走中文（含繁轉簡）。英文／日文原文不當額外查詢。 */
export function isCjkSearchQuery(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (SEARCH_KANA_PATTERN.test(value)) return false;
  return SEARCH_CJK_PATTERN.test(value);
}

function getPunctuationInsensitiveVariants(query: string): string[] {
  const simplified = toSearchSimplified(query.trim());
  const withSpaces = simplified
    .replace(SEARCH_SEPARATOR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutSeparators = simplified
    .replace(SEARCH_SEPARATOR_PATTERN, '')
    .trim();
  return [withSpaces, withoutSeparators].filter(Boolean);
}

// 自定義動漫/影集名稱別名映射（僅保留中文別名，非中文項目不會送往陸源）
const ALIAS_MAP: Record<string, string[]> = {
  木头风纪委员和迷你裙JK: ['废柴风纪委员与裙子长度不合规的JK', '废柴风纪委员'],
  木頭風紀委員和迷你裙JK: ['废柴风纪委员与裙子长度不合规的JK', '废柴风纪委员'],
  木头风纪委员和迷你裙JK的故事: [
    '废柴风纪委员与裙子长度不合规的JK的故事',
    '废柴风纪委员',
  ],
  木頭風紀委員和迷你裙JK的故事: [
    '废柴风纪委员与裙子长度不合规的JK的故事',
    '废柴风纪委员',
  ],
  废柴风纪委员与裙子长度不合规的JK的故事: [
    '木头风纪委员和迷你裙JK的故事',
    '木头风纪委员',
  ],
  ほっかいどうぶつ: [
    '北海道動物',
    '北海道动物',
    '北海道動物學園',
    '北海道动物学园',
  ],
  ほっかいどうぶつ学園: [
    '北海道動物',
    '北海道动物',
    '北海道動物學園',
    '北海道动物学园',
  ],
  北海道動物: ['北海道动物'],
  北海道动物: ['北海道動物'],
  冰与火之歌: ['权力的游戏', '權力的遊戲'],
  冰與火之歌: ['权力的游戏', '權力的遊戲'],
  权力的游戏: ['冰与火之歌', '冰與火之歌'],
  權力的遊戲: ['冰与火之歌', '冰與火之歌'],
  海贼王: ['航海王'],
  海賊王: ['航海王'],
  航海王: ['海贼王', '海賊王'],
  名侦探柯南: ['名偵探柯南', '柯南'],
  名偵探柯南: ['名侦探柯南', '柯南'],
  进击的巨人: ['進擊的巨人', '巨人'],
  進擊的巨人: ['进击的巨人', '巨人'],
  鬼灭之刃: ['鬼滅之刃', '鬼灭'],
  鬼滅之刃: ['鬼灭之刃', '鬼滅'],
  咒术回战: ['咒術迴戰', '咒术'],
  咒術迴戰: ['咒术回战', '咒術'],
  火影忍者: ['火影', '疾风传', '疾風傳'],
  间谍过家家: ['間諜家家酒'],
  間諜家家酒: ['间谍过家家'],
  尖帽子的魔法工房: ['尖帽子的魔法工坊', '尖帽子魔法工房', '尖帽子魔法工坊'],
  尖帽子的魔法工坊: ['尖帽子的魔法工房', '尖帽子魔法工房', '尖帽子魔法工坊'],
  とんがり帽子のアトリエ: [
    '尖帽子的魔法工房',
    '尖帽子的魔法工坊',
    '尖帽子魔法工房',
    '尖帽子魔法工坊',
  ],
  猎人: ['全职猎人', '全職獵人'],
  全职猎人: ['猎人'],
  全職獵人: ['獵人'],
  速度与激情: ['速度與激情', '玩命關頭', '玩命关头'],
  速度與激情: ['速度与激情', '玩命關頭', '玩命关头'],
  玩命關頭: ['速度与激情', '速度與激情', '玩命关头'],
  玩命关头: ['速度与激情', '速度與激情', '玩命關頭'],
  王牌特工: ['金牌特務', '金牌特务'],
  金牌特務: ['王牌特工', '金牌特务'],
  金牌特务: ['王牌特工', '金牌特務'],
  黑客帝国: ['駭客任務', '骇客任务'],
  駭客任務: ['黑客帝国', '骇客任务'],
  骇客任务: ['黑客帝国', '駭客任務'],
  盗梦空间: ['全面啟動', '全面启动'],
  全面啟動: ['盗梦空间', '全面启动'],
  全面启动: ['盗梦空间', '全面啟動'],
  星际穿越: ['星際效應', '星际效应'],
  星際效應: ['星际穿越', '星际效应'],
  星际效应: ['星际穿越', '星際效應'],
  加勒比海盗: ['神鬼奇航'],
  神鬼奇航: ['加勒比海盗'],
  明日边缘: ['明日邊界', '明日边界'],
  明日邊界: ['明日边缘', '明日边界'],
  明日边界: ['明日边缘', '明日邊界'],
  肖申克的救赎: ['刺激1995', '肖申克的救贖'],
  肖申克的救贖: ['刺激1995', '肖申克的救赎'],
  刺激1995: ['肖申克的救赎', '肖申克的救贖'],
  三傻大闹宝莱坞: ['三個傻瓜', '三个傻瓜', '三傻大鬧寶萊塢'],
  三傻大鬧寶萊塢: ['三個傻瓜', '三个傻瓜', '三傻大闹宝莱坞'],
  三個傻瓜: ['三个傻瓜', '三傻大闹宝莱坞', '三傻大鬧寶萊塢'],
  三个傻瓜: ['三個傻瓜', '三傻大闹宝莱坞', '三傻大鬧寶萊塢'],
  摔跤吧爸爸: [
    '我和我的冠軍女兒',
    '我和我的冠军女儿',
    '摔跤吧！爸爸',
    '摔跤吧爸爸',
  ],
  我和我的冠軍女兒: ['我和我的冠军女儿', '摔跤吧！爸爸', '摔跤吧爸爸'],
  我和我的冠军女儿: ['我和我的冠軍女兒', '摔跤吧！爸爸', '摔跤吧爸爸'],
  头脑特工队: ['腦筋急轉彎', '頭腦特工隊'],
  頭腦特工隊: ['腦筋急轉彎', '头脑特工队'],
  腦筋急轉彎: ['头脑特工队', '頭腦特工隊'],
  疯狂动物城: ['動物方城市', '瘋狂動物城'],
  瘋狂動物城: ['動物方城市', '疯狂动物城'],
  動物方城市: ['疯狂动物城', '瘋狂動物城'],
  寻梦环游记: ['COCO夜總會', '尋夢環遊記'],
  尋夢環遊記: ['COCO夜總會', '寻梦环游记'],
  COCO夜總會: ['尋夢環遊記', '寻梦环游记'],
  生化危机: ['惡靈古堡', '生化危機'],
  生化危機: ['惡靈古堡', '生化危机'],
  惡靈古堡: ['生化危机', '生化危機'],
  泰坦尼克号: ['鐵達尼號', '泰坦尼克號'],
  泰坦尼克號: ['鐵達尼號', '泰坦尼克号'],
  鐵達尼號: ['泰坦尼克号', '泰坦尼克號'],
  疾速追杀: ['捍衛任務', '極速追殺'],
  極速追殺: ['捍衛任務', '疾速追杀'],
  捍衛任務: ['疾速追杀', '極速追殺'],
  电锯人: ['鏈鋸人', '電鋸人'],
  電鋸人: ['鏈鋸人', '电锯人'],
  鏈鋸人: ['电锯人', '電鋸人'],
  千与千寻: ['神隱少女', '千與千尋'],
  千與千尋: ['神隱少女', '千与千寻'],
  神隱少女: ['千与千寻', '千與千尋'],
};

export function generateSearchVariants(originalQuery: string): string[] {
  const trimmed = originalQuery.trim();
  const variants = new Set<string>();
  variants.add(trimmed);
  getPunctuationInsensitiveVariants(trimmed).forEach((variant) =>
    variants.add(variant)
  );
  const simplifiedTrimmed = toSearchSimplified(trimmed);
  const aliasMatchCandidates = new Set([trimmed, simplifiedTrimmed]);

  const numberVariant = generateNumberVariant(trimmed);
  if (numberVariant) {
    variants.add(numberVariant);
  }

  const punctuationVariant = generatePunctuationVariant(trimmed);
  if (punctuationVariant) {
    variants.add(punctuationVariant);
  }

  if (trimmed.includes(' ')) {
    const keywords = trimmed.split(/\s+/);
    if (keywords.length >= 2) {
      const lastKeyword = keywords[keywords.length - 1];
      if (/第|季|集|部|篇|章/.test(lastKeyword)) {
        const combined = keywords[0] + lastKeyword;
        variants.add(combined);
      }
      const noSpaces = trimmed.replace(/\s+/g, '');
      variants.add(noSpaces);
    }
  }

  // 處理全形轉半形
  const halfWidth = trimmed
    .replace(/[\uff01-\uff5e]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\u3000/g, ' ');
  if (halfWidth !== trimmed) {
    variants.add(halfWidth);
    const hwLower = halfWidth.toLowerCase();
    if (hwLower !== halfWidth) {
      variants.add(hwLower);
    }
  }

  // 處理英文大小寫，僅保留小寫作為備援
  const lower = trimmed.toLowerCase();
  if (lower !== trimmed) {
    variants.add(lower);
  }

  // 嘗試匹配別名
  for (const [key, aliases] of Object.entries(ALIAS_MAP)) {
    if (
      Array.from(aliasMatchCandidates).some((candidate) =>
        candidate.includes(key)
      )
    ) {
      aliases.forEach((alias) => {
        if (isCjkSearchQuery(alias)) variants.add(alias);
      });
    }
  }

  // 提取核心關鍵字（對於太長的標題，API 容易找不到，可以嘗試提取核心名詞）
  if (
    Array.from(aliasMatchCandidates).some(
      (candidate) => candidate.includes('风纪委员') && candidate.includes('JK')
    )
  ) {
    variants.add('风纪委员');
  }

  return Array.from(variants).filter(
    (variant) => variant === trimmed || isCjkSearchQuery(variant)
  );
}

/**
 * 僅保留不會誤傷影視標題與劇情簡介的台灣常用詞彙轉換。
 * 一般字形與詞彙級繁簡轉換交由 OpenCC (cn -> tw) 處理，
 * 避免單字規則（例如舊版將「组」換成「群組」導致「劇組」變「劇群組」）破壞自然語意。
 */
const DISPLAY_TERM_FIXES: ReadonlyArray<readonly [string, string]> = [
  ['國産', '國產'],
  ['国产', '國產'],
  ['视频', '影片'],
  ['缓存', '快取'],
  ['设置', '設定'],
  ['账号', '帳號'],
  ['賬號', '帳號'],
  ['加载', '載入'],
  ['网络', '網路'],
];

/**
 * 名稱以 🎬 開頭的片源（如「🎬非凡资源」）：只保留 🎬 前綴記號本身，
 * 後面的名稱仍走繁簡轉換與台灣用語（避免換源清單簡繁混雜）。
 */
export function shouldPreserveSourceDisplayName(name: string): boolean {
  return /^\s*🎬/.test(name);
}

/** 切出 🎬 前綴（含前後空白），只轉換後面的名稱本體 */
function splitSourcePrefix(text: string): [string, string] {
  const match = text.match(/^(\s*🎬\s*)/);
  if (!match) return ['', text];
  return [match[1], text.slice(match[1].length)];
}

export function toDisplayLanguage(text: string): string {
  // 🎬 前綴片源：前綴記號保留，後面的名稱仍轉繁體／台灣用語
  const [prefix, body] = splitSourcePrefix(text);
  let result = body;
  for (const [simp, trad] of DISPLAY_TERM_FIXES) {
    result = result.split(simp).join(trad);
  }
  return prefix + convertS2T(result);
}

/**
 * 影視標題專用顯示轉換：
 * 1. 優先將大陸譯名（例如「间谍过家家」、「疯狂动物城」、「头脑特工队」）轉換為台灣正體譯名（如「間諜家家酒」、「動物方城市」、「腦筋急轉彎」）。
 * 2. 接著進行台灣用語修正與 OpenCC 繁體中文轉換。
 */
export function toDisplayTitle(text: string): string {
  if (!text) return '';
  const taiwanTitle = getTaiwanDisplayTitle(text);
  return toDisplayLanguage(taiwanTitle);
}

export function cleanQueryForApi(rawQuery: string): string {
  if (!rawQuery) return rawQuery;

  let k = rawQuery.trim();

  // 1. 移除括號及括號內的修飾詞（如「(第一季)」「（僅限）」）
  //    保留短內容（≤3字且不含季數標記），避免誤刪標題本體（如「鉴定士(伪)」）
  k = k
    .replace(
      /\s*[（(]([^）)]*)[）)]\s*/g,
      (_match: string, content: string) => {
        const trimmed = content.trim();
        // 保留短標題內文（≤3字且不含季/部/集等元數據關鍵字）
        if (
          trimmed.length <= 3 &&
          !/[第季部話话集期\d]/.test(trimmed) &&
          !/^(僅限|限定|未删减?|删减|无修|有修|中字|字幕|高清|超清|蓝光|藍光|繁中|简中|简体|繁體)$/.test(
            trimmed
          )
        ) {
          return '(' + trimmed + ')';
        }
        return '';
      }
    )
    .trim();

  // 1.5 移除中括號及中括號內的修飾詞（如「【第一季】」「[1080P]」等）
  k = k
    .replace(/【[^】]*】/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim();

  // 2. 日文助詞：只轉漢字中間的「の」。裝飾符號改成空格，方便陸源 LIKE。
  k = convertJapaneseParticlesForSearch(k);
  k = k
    .replace(/[☆★♪♥♡※＊*×✕✖·・～~!！?？]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 3. 移除結尾的常見干擾後綴（季、期、部、版等）
  k = k
    .replace(
      /([\s\u3000]*(?:第[一二三四五六七八九十\d]+(?:季|期|部(?!分)|部分|話|话|集)|Season\s*\d+|Part\s*\d+|S\d+|動畫版|动画版|真人版|劇場版|剧场版|的故事))+$/gi,
      ''
    )
    .trim();

  // 4. 清除頭尾的標點符號和多餘空格
  k = k.replace(/^[\s\-_,.：，。！？]+|[\s\-_,.：，。！？]+$/g, '').trim();

  return k || rawQuery.trim();
}
