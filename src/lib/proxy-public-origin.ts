import { isTrustedProxy } from './same-site';

/**
 * 重寫 m3u8 分片／金鑰代理網址時用的對外 origin。
 * 未設 TRUST_PROXY 時不採信 X-Forwarded-*，避免客戶端把分片導去攻擊者網域。
 */
export function resolvePublicProxyOrigin(
  req: Request,
  env: { TRUST_PROXY?: string; [key: string]: string | undefined } = process.env
): { protocol: string; host: string } {
  const requestUrl = new URL(req.url);
  const trustProxy = isTrustedProxy(env);
  const forwardedProtocol = trustProxy
    ? req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    : undefined;
  const forwardedHost = trustProxy
    ? req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    : undefined;

  const protocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? forwardedProtocol
      : requestUrl.protocol.replace(':', '') || 'http';
  const host = forwardedHost || req.headers.get('host') || requestUrl.host;

  return { protocol, host };
}
