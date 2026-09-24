export function isTrustedProxy(
  env: {
    TRUST_PROXY?: string;
    [key: string]: string | undefined;
  } = process.env
): boolean {
  const normalized = env.TRUST_PROXY?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * 轉發標頭逗號清單裡，最右邊那一截是最靠近這台機器的反代寫上的。
 * 客戶端自己附在前面的值不會蓋過它。只有一截時結果與以前相同。
 */
export function nearestForwardedToken(
  header: string | null | undefined
): string {
  if (!header) return '';
  const parts = header.split(',');
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const token = parts[index].trim();
    if (token) return token;
  }
  return '';
}

/** TRUST_PROXY 開啟後，從轉發標頭取出客戶端位址。 */
export function clientAddressFromProxyHeaders(headers: {
  get(name: string): string | null;
}): string {
  return (
    nearestForwardedToken(headers.get('x-forwarded-for')) ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  ).slice(0, 128);
}

/**
 * Origin 的 host 是否與本站一致。
 *
 * 只比 host、不比 scheme：Cloudflare／反向代理在邊緣終止 TLS 時，
 * 瀏覽器 Origin 是 https://…，容器看到的 Host 卻是 http 內部位址，
 * 比完整 origin 會在正式站誤 403。攻擊頁的 host 一定不同，比 host 足夠。
 *
 * x-forwarded-host 僅在 TRUST_PROXY 時採信，否則客戶端可偽造成「同源」。
 */
export function isSameSiteHost(
  request: Request,
  env: { TRUST_PROXY?: string; [key: string]: string | undefined } = process.env
): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const expectedHost = resolveExpectedHost(request, env);
    if (!expectedHost) return false;
    return originHost === expectedHost;
  } catch {
    return false;
  }
}

function resolveExpectedHost(
  request: Request,
  env: { TRUST_PROXY?: string; [key: string]: string | undefined }
): string {
  if (isTrustedProxy(env)) {
    const forwarded = nearestForwardedToken(
      request.headers.get('x-forwarded-host')
    );
    if (forwarded) return forwarded.toLowerCase();
  }

  return (request.headers.get('host') || '').toLowerCase();
}

export function rejectCrossSiteRequest(request: Request): Response | null {
  if (isSameSiteHost(request)) return null;
  return Response.json(
    { error: 'Forbidden' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * sendBeacon 關頁存檔常不帶 Origin。沒有 Origin 時放行，有 Origin 才擋跨站。
 */
export function rejectCrossSiteRequestIfOrigin(
  request: Request
): Response | null {
  if (!request.headers.get('origin')) return null;
  return rejectCrossSiteRequest(request);
}
