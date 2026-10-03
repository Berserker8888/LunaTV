import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';

import { setBoundedMapValue } from './bounded-map';

export {
  readResponseBytesWithLimit,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  RemoteResponseTooLargeError,
} from './response-limit';

/**
 * 被封鎖的子網資料表。
 *
 * 用 node:net BlockList 取代手寫的 IPv4 regex／字串前綴比對。
 * 測試會直接遍歷這張表，確保每條規則都有對應的測試案例。
 *
 * 注意 BlockList 不會自動涵蓋的範圍（已實測確認）：
 * - 0.0.0.0/8、100.64.0.0/10、198.18.0.0/15、::/128 都要明列
 * - ::ffff:a.b.c.d 這類 IPv4-mapped 會自動對應到 IPv4 規則（已實測）
 * - ::/96（IPv4 相容位址，已廢棄但仍可被利用）要明列
 * - NAT64 的 64:ff9b::/96「不」整段封：在 IPv6-only＋DNS64 的主機上，
 *   所有公網 IPv4 站點都會解析到這個範圍，整段封會打壞整個代理。
 *   改為取出最後 32 bit 走 IPv4 規則（見 nat64ToIpv4）。
 */
export const BLOCKED_SUBNETS: Array<{
  subnet: string;
  prefix: number;
  type: 'ipv4' | 'ipv6';
  comment: string;
}> = [
  // IPv4
  { subnet: '0.0.0.0', prefix: 8, type: 'ipv4', comment: '本機軟體範圍' },
  { subnet: '10.0.0.0', prefix: 8, type: 'ipv4', comment: '私有網路' },
  {
    subnet: '100.64.0.0',
    prefix: 10,
    type: 'ipv4',
    comment: '電信級 NAT 共用位址',
  },
  { subnet: '127.0.0.0', prefix: 8, type: 'ipv4', comment: '迴環' },
  { subnet: '169.254.0.0', prefix: 16, type: 'ipv4', comment: '連結本地位址' },
  { subnet: '172.16.0.0', prefix: 12, type: 'ipv4', comment: '私有網路' },
  { subnet: '192.168.0.0', prefix: 16, type: 'ipv4', comment: '私有網路' },
  { subnet: '198.18.0.0', prefix: 15, type: 'ipv4', comment: '基準測試用' },
  // IPv6
  { subnet: '::', prefix: 128, type: 'ipv6', comment: '未指定位址' },
  { subnet: '::1', prefix: 128, type: 'ipv6', comment: '迴環' },
  {
    subnet: '::',
    prefix: 96,
    type: 'ipv6',
    comment: 'IPv4 相容位址（已廢棄）',
  },
  { subnet: 'fc00::', prefix: 7, type: 'ipv6', comment: '唯一本地位址' },
  { subnet: 'fe80::', prefix: 10, type: 'ipv6', comment: '連結本地位址' },
  { subnet: 'ff00::', prefix: 8, type: 'ipv6', comment: '群播' },
];

const blockedList = new BlockList();
for (const rule of BLOCKED_SUBNETS) {
  blockedList.addSubnet(rule.subnet, rule.prefix, rule.type);
}

/** 只裝 NAT64 前綴的檢查表，用來判斷是否需要拆出內嵌 IPv4 */
const nat64List = new BlockList();
nat64List.addSubnet('64:ff9b::', 96, 'ipv6');

/** 把 IPv6 縮寫展開成 8 組完整 hex。失敗回 null。 */
function expandIpv6(address: string): string[] | null {
  const lower = address.toLowerCase();
  // 內嵌 IPv4 dotted（::ffff:1.2.3.4 形式）先轉成兩組 hex
  const withHex = lower.replace(
    /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
    (_m: string, dotted: string) => {
      const bytes = dotted.split('.').map(Number);
      if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
        return ':';
      }
      return `:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
    }
  );

  const halves = withHex.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) {
    return null;
  }
  return groups;
}

/**
 * NAT64 位址（64:ff9b::/96）最後 32 bit 是內嵌的 IPv4。
 * 取出來走 IPv4 規則，而不是整段封掉。
 */
function nat64ToIpv4(address: string): string | null {
  const expanded = expandIpv6(address);
  if (!expanded) return null;
  const high = Number.parseInt(expanded[6], 16);
  const low = Number.parseInt(expanded[7], 16);
  if (Number.isNaN(high) || Number.isNaN(low)) return null;
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join(
    '.'
  );
}

/**
 * 判斷字面 IP 是否被封鎖。同步，可用於 parseSafeRemoteUrl 的預檢。
 *
 * localhost 是主機名不是 IP，BlockList 處理不了，保留字串判斷。
 */
export function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const ipType = isIP(normalized);
  if (ipType === 0) {
    return /^localhost$/i.test(normalized);
  }

  if (ipType === 6 && nat64List.check(normalized, 'ipv6')) {
    const embedded = nat64ToIpv4(normalized);
    // 拆不出內嵌 IPv4 就當可疑，直接擋掉
    if (!embedded) return true;
    return blockedList.check(embedded, 'ipv4');
  }

  return blockedList.check(normalized, ipType === 4 ? 'ipv4' : 'ipv6');
}
const DNS_SAFETY_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_DNS_SAFETY_CACHE_ENTRIES = 1000;
const MAX_PINNED_AGENTS = 100;
/**
 * DNS 查詢逾時。
 *
 * node 的 dns.lookup 走 libuv 執行緒池（預設僅 4 條），既不吃 AbortSignal
 * 也沒有內建逾時——呼叫端設的 AbortController 完全管不到這一段。解析器一慢，
 * 卡住的查詢會佔滿執行緒池，連帶拖垮同行程中所有需要執行緒池的工作
 * （檔案 I/O、gzip、scrypt 密碼驗證）。這裡自己加上限，讓單張圖片失敗，
 * 而不是整站一起等。
 */
const DNS_LOOKUP_TIMEOUT_MS = 5000;
/**
 * 解析失敗的負面快取，避免死掉的主機每次請求都再賠上一次逾時。
 *
 * 刻意取短（10 秒）：這台部署主機的 DNS 是「慢但可用」，逾時有機會誤判到
 * 正常的圖床。快取太久等於讓一次瞬斷把好主機停用一段時間，海報會整批破圖。
 * 10 秒足以擋掉單次頁面載入內的重複重試，又能讓瞬斷很快恢復。
 */
const DNS_FAILURE_CACHE_TTL_MS = 10 * 1000;
const MAX_DNS_FAILURE_CACHE_ENTRIES = 500;
const dnsSafetyCache = new Map<
  string,
  { expiresAt: number; addresses: Array<{ address: string }> }
>();
const dnsFailureCache = new Map<string, number>();
/**
 * 同一主機名的並發查詢去重。
 *
 * 首頁一次載入數十張海報，同一個圖床冷快取時會同時發出多次「一模一樣」的
 * 解析請求，每一次都吃掉一個執行緒池名額。共用同一個 Promise 後，N 次併發
 * 只會實際查詢一次。
 */
const inFlightLookups = new Map<string, Promise<Array<{ address: string }>>>();
const pinnedAgentCache = new Map<string, Agent>();

class DnsLookupTimeoutError extends Error {
  constructor(hostname: string) {
    super(`DNS lookup timed out: ${hostname}`);
    this.name = 'DnsLookupTimeoutError';
  }
}

function lookupWithTimeout(
  hostname: string
): Promise<Array<{ address: string }>> {
  const existing = inFlightLookups.get(hostname);
  if (existing) return existing;

  const lookupPromise = lookup(hostname, { all: true, verbatim: true });
  // 逾時後底層的 getaddrinfo 仍會在執行緒池裡跑到完才 settle，而那時 race
  // 早已 reject、沒有人再接它。先掛一個吞掉錯誤的 handler，否則會變成
  // 未處理的 promise rejection。
  lookupPromise.catch(() => undefined);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.race([
    lookupPromise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new DnsLookupTimeoutError(hostname)),
        DNS_LOOKUP_TIMEOUT_MS
      );
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
    inFlightLookups.delete(hostname);
  });

  inFlightLookups.set(hostname, pending);
  return pending;
}

function getNormalizedHostname(parsed: URL): string {
  return parsed.hostname.replace(/^\[|\]$/g, '');
}

/**
 * 解析後的位址是否被封鎖。
 *
 * 保留原函式名（呼叫點不變），實作改走 BlockList。
 * 舊的手寫 isPrivateIpv4 已刪除，邏輯收斂到 isBlockedAddress。
 */
function isPrivateResolvedAddress(address: string): boolean {
  return isBlockedAddress(address);
}

type ResolvedAddress = { address: string; family: 4 | 6 };

async function resolveSafeRemoteAddresses(
  parsed: URL
): Promise<ResolvedAddress[]> {
  const hostname = getNormalizedHostname(parsed);

  if (isIP(hostname)) {
    if (isPrivateResolvedAddress(hostname)) {
      throw new UnsafeRemoteUrlError('Unsafe remote address');
    }
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }

  const now = Date.now();
  const cached = dnsSafetyCache.get(hostname);
  let addresses = cached && cached.expiresAt > now ? cached.addresses : null;

  if (!addresses) {
    const failedUntil = dnsFailureCache.get(hostname);
    if (failedUntil !== undefined) {
      if (failedUntil > now) {
        throw new UnsafeRemoteUrlError('Unable to resolve remote host');
      }
      dnsFailureCache.delete(hostname);
    }

    try {
      addresses = await lookupWithTimeout(hostname);
    } catch {
      setBoundedMapValue(
        dnsFailureCache,
        hostname,
        now + DNS_FAILURE_CACHE_TTL_MS,
        MAX_DNS_FAILURE_CACHE_ENTRIES
      );
      throw new UnsafeRemoteUrlError('Unable to resolve remote host');
    }
  }

  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateResolvedAddress(entry.address))
  ) {
    throw new UnsafeRemoteUrlError('Unsafe resolved remote address');
  }

  if (!cached || cached.expiresAt <= now) {
    setBoundedMapValue(
      dnsSafetyCache,
      hostname,
      {
        expiresAt: now + DNS_SAFETY_CACHE_TTL_MS,
        addresses,
      },
      MAX_DNS_SAFETY_CACHE_ENTRIES
    );
  }

  // IPv4 優先：許多 VPS 沒有 IPv6 出口，若網域（如 Cloudflare）AAAA 排前面，
  // 釘死在 IPv6 會直接連線失敗；保留全部位址讓連線層可依序退回。
  return [...addresses]
    .sort(
      (a, b) =>
        (isIP(a.address) === 4 ? 0 : 1) - (isIP(b.address) === 4 ? 0 : 1)
    )
    .map((entry) => ({
      address: entry.address,
      family: isIP(entry.address) as 4 | 6,
    }));
}

function getPinnedAgent(hostname: string, targets: ResolvedAddress[]): Agent {
  const key = `${hostname}:${targets.map((t) => t.address).join(',')}`;
  const cached = pinnedAgentCache.get(key);
  if (cached) return cached;

  const agent = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) {
          callback(
            null,
            targets.map((t) => ({ address: t.address, family: t.family }))
          );
        } else {
          callback(null, targets[0].address, targets[0].family);
        }
      },
    },
  });
  pinnedAgentCache.set(key, agent);
  while (pinnedAgentCache.size > MAX_PINNED_AGENTS) {
    const oldestKey = pinnedAgentCache.keys().next().value as
      string | undefined;
    if (!oldestKey) break;
    const evicted = pinnedAgentCache.get(oldestKey);
    pinnedAgentCache.delete(oldestKey);
    void evicted?.close();
  }
  return agent;
}

/** 帶 Location 的重導向狀態碼（304 / 300 不在其列，它們不是重導向） */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class UnsafeRemoteUrlError extends Error {
  constructor(message = 'Unsafe remote URL') {
    super(message);
    this.name = 'UnsafeRemoteUrlError';
  }
}

export function parseSafeRemoteUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const hostname = getNormalizedHostname(parsed);
    // 字面 IP（含 localhost 字串）在這裡先做同步預檢；
    // 非 IP 主機名交給後續 DNS 解析後的檢查。
    // isBlockedAddress 對一般主機名本來就回 false，所以直接呼叫即可。
    if (isBlockedAddress(hostname)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isSafeRemoteUrl(url: string): boolean {
  return parseSafeRemoteUrl(url) !== null;
}

export async function fetchSafeRemoteUrl(
  url: string,
  init?: RequestInit,
  maxRedirects = 5
): Promise<Response> {
  let currentUrl = parseSafeRemoteUrl(url);
  if (!currentUrl) {
    throw new UnsafeRemoteUrlError();
  }

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const targets = await resolveSafeRemoteAddresses(currentUrl);
    const dispatcher = getPinnedAgent(
      getNormalizedHostname(currentUrl),
      targets
    );

    const response = await fetch(currentUrl.toString(), {
      ...init,
      redirect: 'manual',
      dispatcher,
    } as RequestInit & { dispatcher: Agent });

    // 只跟隨真正帶 Location 的重導向。3xx 不等於重導向——304 Not Modified、
    // 300 Multiple Choices 都在這個區間卻沒有 Location，原本會被當成重導向
    // 處理、body 先被 cancel 掉才回傳，呼叫端拿到的是讀不動的空殼。
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    // 重導向狀態碼卻沒有 Location 是壞掉的回應，無從跟隨，當成錯誤處理。
    // 呼叫端本來就都有接 UnsafeRemoteUrlError。
    if (!location) {
      void response.body?.cancel().catch(() => undefined);
      throw new UnsafeRemoteUrlError('Redirect without Location header');
    }
    void response.body?.cancel().catch(() => undefined);

    const nextUrl = parseSafeRemoteUrl(
      new URL(location, currentUrl).toString()
    );
    if (!nextUrl) {
      throw new UnsafeRemoteUrlError('Unsafe redirect URL');
    }
    currentUrl = nextUrl;
  }

  throw new UnsafeRemoteUrlError('Too many redirects');
}

export function getSafeImageContentType(
  contentType: string | null
): string | null {
  if (!contentType) {
    return null;
  }

  const normalizedType = contentType.split(';')[0].trim().toLowerCase();
  const allowedTypes = new Set([
    'image/avif',
    'image/bmp',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
  ]);

  return allowedTypes.has(normalizedType) ? normalizedType : null;
}
