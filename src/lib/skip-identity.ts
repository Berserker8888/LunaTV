import { generateStorageKey } from './storage-key';

/** 與真實 CMS source key 錯開，避免寫入跳過設定時撞到片源名稱。 */
export const SKIP_IDENTITY_SOURCE = '_skip';

export type SkipIdentityParts = {
  source: typeof SKIP_IDENTITY_SOURCE;
  id: string;
};

function normalizeSkipTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（）()【】[\]『』「」·・.。]/g, '');
}

/** 穩定短雜湊：瀏覽器與 Node 都能用，不必等 Web Crypto。 */
export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 版本關鍵詞：同一豆瓣 ID 的不同剪輯版本，片頭片尾秒數可能不同，
 * 不能共用同一組秒數。
 */
const VERSION_KEYWORDS = [
  '導演剪輯版',
  '导演剪辑版',
  '導演版',
  '导演版',
  '加長版',
  '加长版',
  '劇場版',
  '剧场版',
  '完整版',
  '未刪減版',
  '未删减版',
  '未刪減',
  '未删减',
  '修復版',
  '修复版',
  '重製版',
  '重制版',
  '終極版',
  '终极版',
  'director',
  'extended',
  'uncut',
];

/**
 * 從標題萃取版本標籤（去重＋排序，保證同一版本永遠得到同一標籤）。
 * 例如「沙丘2 導演剪輯版」→ '導演剪輯版'；無版本詞回 ''。
 */
export function extractVersionTag(title: string | null | undefined): string {
  const t = (title ?? '').toLowerCase().replace(/\s+/g, '');
  if (!t) return '';
  const found = VERSION_KEYWORDS.filter((kw) => t.includes(kw));
  if (found.length === 0) return '';
  return [...new Set(found)].sort().join('|');
}

/**
 * 片頭片尾綁「這部片」而不是單一源。
 * 有豆瓣 ID 用 d{id}；否則用正規化標題＋年份的雜湊。
 * 同一豆瓣 ID 的不同剪輯版本（導演剪輯版／加長版／劇場版）秒數可能不同：
 * 標題帶版本詞時身份加上版本雜湊，避免共用秒數。
 */
export function makeSkipIdentityParts(input: {
  doubanId?: number | string | null;
  title?: string | null;
  year?: string | number | null;
}): SkipIdentityParts | null {
  const rawTitle = typeof input.title === 'string' ? input.title : '';
  const douban = Number(input.doubanId);
  if (Number.isFinite(douban) && douban > 0) {
    const versionTag = extractVersionTag(rawTitle);
    const id = versionTag
      ? `d${Math.trunc(douban)}v${fnv1a32Hex(versionTag)}`
      : `d${Math.trunc(douban)}`;
    return { source: SKIP_IDENTITY_SOURCE, id };
  }

  const title = normalizeSkipTitle(rawTitle);
  if (!title) return null;
  const year = String(input.year ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  return {
    source: SKIP_IDENTITY_SOURCE,
    id: `t${fnv1a32Hex(`${title}|${year}`)}`,
  };
}

export function makeSkipIdentityKey(input: {
  doubanId?: number | string | null;
  title?: string | null;
  year?: string | number | null;
}): string | null {
  const parts = makeSkipIdentityParts(input);
  if (!parts) return null;
  return generateStorageKey(parts.source, parts.id);
}
