/** 點播直連失敗後，改走 CORSAPI Worker，再不行才走站內 HLS 代理。 */

export type VodTransport = 'direct' | 'corsapi' | 'station';

export function normalizeCorsApiOrigin(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return null;
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getCorsApiOrigin(
  runtime?: { CORSAPI_ORIGIN?: string },
  storage?: { getItem(key: string): string | null } | null,
  envOrigin?: string | null
): string | null {
  try {
    const stored = storage?.getItem('corsApiOrigin');
    const fromStorage = normalizeCorsApiOrigin(stored);
    if (fromStorage) return fromStorage;
  } catch {
    /* private mode */
  }
  return (
    normalizeCorsApiOrigin(runtime?.CORSAPI_ORIGIN) ||
    normalizeCorsApiOrigin(envOrigin)
  );
}

export function readCorsApiOriginFromBrowser(): string | null {
  if (typeof window === 'undefined') {
    return normalizeCorsApiOrigin(process.env.NEXT_PUBLIC_CORSAPI_ORIGIN);
  }
  return getCorsApiOrigin(
    window.RUNTIME_CONFIG,
    window.localStorage,
    process.env.NEXT_PUBLIC_CORSAPI_ORIGIN
  );
}

export function buildVodHlsProxyUrl(
  directUrl: string,
  sourceKey: string
): string {
  const params = new URLSearchParams();
  params.set('url', directUrl);
  params.set('moontv-source', sourceKey);
  params.set('kind', 'vod');
  return `/api/proxy/m3u8?${params.toString()}`;
}

export function buildCorsApiM3u8Url(origin: string, directUrl: string): string {
  const base = normalizeCorsApiOrigin(origin);
  if (!base) return directUrl;
  return `${base}/m3u8?url=${encodeURIComponent(directUrl)}`;
}

export function isVodHlsProxyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, 'http://lunatv.invalid');
    return (
      parsed.pathname === '/api/proxy/m3u8' &&
      parsed.searchParams.get('kind') === 'vod'
    );
  } catch {
    return false;
  }
}

export function isCorsApiM3u8Url(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, 'http://lunatv.invalid');
    return parsed.pathname === '/m3u8' && parsed.searchParams.has('url');
  } catch {
    return false;
  }
}

export function detectVodTransport(
  url: string | null | undefined
): VodTransport {
  if (isVodHlsProxyUrl(url)) return 'station';
  if (isCorsApiM3u8Url(url)) return 'corsapi';
  return 'direct';
}

export function resolveVodPlaybackUrl(options: {
  directUrl: string;
  sourceKey: string;
  transport: VodTransport;
  corsApiOrigin?: string | null;
}): string {
  const directUrl = options.directUrl;
  if (!directUrl) return '';
  if (options.transport === 'corsapi') {
    if (options.corsApiOrigin) {
      return buildCorsApiM3u8Url(options.corsApiOrigin, directUrl);
    }
    if (options.sourceKey) {
      return buildVodHlsProxyUrl(directUrl, options.sourceKey);
    }
    return directUrl;
  }
  if (options.transport === 'station' && options.sourceKey) {
    return buildVodHlsProxyUrl(directUrl, options.sourceKey);
  }
  return directUrl;
}

export function nextVodTransportOnNetworkError(
  current: VodTransport,
  hasCorsApi: boolean
): VodTransport | null {
  if (current === 'direct') return hasCorsApi ? 'corsapi' : 'station';
  if (current === 'corsapi') return 'station';
  return null;
}

/** 直連出現無法恢復的網路錯誤時，才降級走代理。 */
export function shouldFallbackToVodProxy(
  errorType: string,
  alreadyProxied: boolean
): boolean {
  return !alreadyProxied && errorType === 'networkError';
}
