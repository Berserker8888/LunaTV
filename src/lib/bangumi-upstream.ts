import { readResponseJsonWithLimit } from '@/lib/response-limit';

/** 官方 API 失敗時改問桜色鏡像，路徑與官方相同。 */
export const BANGUMI_API_ORIGINS = [
  'https://api.bgm.tv',
  'https://api.bangumi.lol',
] as const;

export const BANGUMI_OFFICIAL_ORIGIN = BANGUMI_API_ORIGINS[0];

function isSafeBangumiPath(path: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(path) && !path.includes('..');
}

/**
 * 依序詢問 Bangumi 來源。官方 404 仍會再問鏡像；
 * 全部都是 404 才當成找不到。連線失敗或內容無法解析也會換下一個來源。
 */
export async function fetchBangumiJson<T>(
  path: string,
  options: {
    headersFor: (origin: string) => Record<string, string>;
    timeoutMs: number;
    maxBytes: number;
    parse: (value: unknown) => T | null;
  }
): Promise<
  { status: 'ok'; data: T } | { status: 'not-found' } | { status: 'failed' }
> {
  const normalized = path.replace(/^\/+/, '');
  if (!isSafeBangumiPath(normalized)) return { status: 'failed' };

  let sawNotFound = false;
  for (const origin of BANGUMI_API_ORIGINS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(`${origin}/${normalized}`, {
        signal: controller.signal,
        headers: options.headersFor(origin),
      });
      if (response.status === 404) {
        void response.body?.cancel().catch(() => undefined);
        sawNotFound = true;
        continue;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        continue;
      }
      const data = await readResponseJsonWithLimit<unknown>(
        response,
        options.maxBytes
      );
      const parsed = options.parse(data);
      if (parsed !== null) return { status: 'ok', data: parsed };
    } catch {
      // 逾時或連線失敗，改問下一個來源。
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return sawNotFound ? { status: 'not-found' } : { status: 'failed' };
}
