import { setBoundedMapValue } from './bounded-map';
import { readResponseTextWithLimit } from './response-limit';
import { convertT2S } from './s2t';

/**
 * 同步 64 位雜湊（cyrb53）：douban.ts 會被客戶端 bundle 直接引用
 * （douban.client.ts 從這裡拿 toSimplified），不能用 node:crypto。
 * 這裡只是快取 key，不需要密碼學強度；輸出固定 16 hex，key 長度有界。
 */
function hashCacheKey(input: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

interface CachedDoubanEntry {
  expiresAt: number;
  data: unknown;
}

const DOUBAN_CACHE = new Map<string, CachedDoubanEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分鐘快取生命週期
const MAX_DOUBAN_CACHE_ENTRIES = 200;
const MAX_DOUBAN_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * 豆瓣快取 key 產生器：參數先截短再雜湊，避免使用者輸入直接拼進 key
 * 把記憶體快取的 key 空間灌爆（key 長度固定 16 hex）。
 */
export function doubanCacheKey(
  namespace: string,
  ...parts: Array<string | number>
): string {
  const normalized = parts.map((p) => String(p).slice(0, 128)).join('|');
  return `${namespace}:${hashCacheKey(normalized)}`;
}

/**
 * 通用的豆瓣数据获取函数
 * @param url 请求的URL
 * @returns Promise<T> 返回指定类型的数据
 */
export async function fetchDoubanData<T>(url: string): Promise<T> {
  const now = Date.now();
  const cached = DOUBAN_CACHE.get(url);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  // 新增超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  // 设置请求选项，包括信号和头部
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://movie.douban.com',
    },
  };

  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const responseText = await readResponseTextWithLimit(
      response,
      MAX_DOUBAN_RESPONSE_BYTES
    );
    const data = JSON.parse(responseText) as T;

    // 成功後寫入快取
    setBoundedMapValue(
      DOUBAN_CACHE,
      url,
      {
        expiresAt: Date.now() + CACHE_TTL_MS,
        data,
      },
      MAX_DOUBAN_CACHE_ENTRIES
    );

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

const T2S_MAP: Record<string, string> = {
  // 一級分類
  熱門: '热门',
  最新: '最新',
  冷門佳片: '冷门佳片',
  豆瓣高分: '豆瓣高分',
  番劇: '番剧',
  劇場版: '剧场版',
  最近熱門: '最近热门',
  每日放送: '每日放送',

  // 形式（作為 selected_categories.形式 與 tags 送出）。
  // 缺這兩筆會讓「電視劇／綜藝」分頁的「全部」永遠查無結果：
  // 豆瓣只認簡體，收到繁體時回傳 0 筆。
  電視劇: '电视剧',
  綜藝: '综艺',

  // 類型 / 標籤
  喜劇: '喜剧',
  愛情: '爱情',
  動作: '动作',
  科幻: '科幻',
  懸疑: '悬疑',
  犯罪: '犯罪',
  驚悚: '惊悚',
  冒險: '冒险',
  音樂: '音乐',
  歷史: '历史',
  奇幻: '奇幻',
  恐怖: '恐怖',
  戰爭: '战争',
  傳記: '传记',
  歌舞: '歌舞',
  武俠: '武侠',
  情色: '情色',
  災難: '灾难',
  西部: '西部',
  紀錄片: '纪录片',
  短片: '短片',
  古裝: '古装',
  家庭: '家庭',
  劇情: '剧情',
  真人秀: '真人秀',
  脫口秀: '脱口秀',

  // 地區
  華語: '华语',
  歐美: '欧美',
  韓國: '韩国',
  日本: '日本',
  中國大陸: '中国大陆',
  美國: '美国',
  中國香港: '中国香港',
  中國臺灣: '中国台湾',
  英國: '英国',
  法國: '法国',
  德國: '德国',
  意大利: '意大利',
  西班牙: '西班牙',
  印度: '印度',
  泰國: '泰国',
  俄羅斯: '俄罗斯',
  加拿大: '加拿大',
  澳大利亞: '澳大利亚',
  愛爾蘭: '爱尔兰',
  瑞典: '瑞典',
  巴西: '巴西',
  丹麥: '丹麦',
  國外: '国外',

  // 平台
  騰訊影片: '腾讯视频',
  愛奇藝: '爱奇艺',
  優酷: '优酷',
  湖南衛視: '湖南卫视',

  // 動漫標籤
  定格動畫: '定格动画',
  美國動畫: '美国动画',
  黑色幽默: '黑色幽默',
  兒童: '儿童',
  二次元: '二次元',
  動物: '动物',
  青春: '青春',
  勵志: '励志',
  惡搞: '恶搞',
  治癒: '治愈',
  運動: '运动',
  後宮: '后宫',
  國漫: '国漫',
  人性: '人性',
  戀愛: '恋爱',
  魔幻: '魔幻',
};

/**
 * 將繁體中文轉換為簡體中文，以符合豆瓣 API 的參數要求。
 *
 * 對照表未命中時改用通用轉換器，而不是把原字串直接送出去——豆瓣收到繁體
 * 會回傳 0 筆且不報錯，症狀是「篩選後整頁空白」，很難聯想到是參數語言問題。
 * 對照表仍保留在前，因為部分詞的豆瓣用語與逐字轉換結果不同（例如分類名）。
 */
export function toSimplified(str: string): string {
  if (!str) return '';
  // 用 hasOwnProperty 而非直接索引：str 來自查詢參數，值為 'constructor' 或
  // 'toString' 時會取到原型鏈上的函式，讓這個宣告回傳 string 的函式實際回傳
  // 一個函式，接著被拼進豆瓣的請求參數裡。
  const mapped = Object.prototype.hasOwnProperty.call(T2S_MAP, str)
    ? T2S_MAP[str]
    : undefined;
  if (mapped) return mapped;
  try {
    return convertT2S(str) || str;
  } catch {
    return str;
  }
}
