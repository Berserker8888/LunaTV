import { NextResponse } from 'next/server';

import { filterAdsFromM3U8Detailed } from '@/lib/hls-ad-filter';
import { getBaseUrl, resolveUrl } from '@/lib/live';
import {
  authorizeProxyFetch,
  type ProxyKind,
  proxyKindQuery,
} from '@/lib/proxy-access';
import { resolvePublicProxyOrigin } from '@/lib/proxy-public-origin';
import {
  fetchSafeRemoteUrl,
  readResponseTextWithLimit,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const M3U8_FETCH_TIMEOUT_MS = 10000;
const MAX_M3U8_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request) {
  const access = await authorizeProxyFetch(request, 'm3u8');
  if (!access.ok) return access.response;

  const { url, source, kind, fetchHeaders, rememberHost } = access;
  // allowCORS 預設關閉：開啟會讓播放清單內嵌上游原始 URL（含簽名 token）
  // 而不走代理。僅在管理員以環境變數明確允許時才接受該查詢參數。
  const allowCORS =
    process.env.PROXY_ALLOW_CORS === 'true' &&
    new URL(request.url).searchParams.get('allowCORS') === 'true';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), M3U8_FETCH_TIMEOUT_MS);

  let response: Response | null = null;
  let responseUsed = false;

  try {
    response = await fetchSafeRemoteUrl(url, {
      cache: 'no-cache',
      credentials: 'same-origin',
      headers: fetchHeaders,
      signal: controller.signal,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch m3u8' },
        { status: 500 }
      );
    }

    // 不信任上游 Content-Type；不少 IPTV 來源會漏掉或錯標類型。
    // 端點只接受真正的 HLS manifest，並以大小與逾時限制完整讀取後重寫。
    const finalUrl = response.url;

    const m3u8Content = await readResponseTextWithLimit(
      response,
      MAX_M3U8_BYTES
    );
    responseUsed = true;
    if (!m3u8Content.trimStart().startsWith('#EXTM3U')) {
      return NextResponse.json(
        { error: 'Upstream response is not an HLS manifest' },
        { status: 415 }
      );
    }

    // 確認是清單後才記住 host，避免開放重導向把攻擊者域名寫進白名單
    rememberHost(url);
    if (finalUrl) rememberHost(finalUrl);

    const filteredContent = m3u8Content.includes('#EXTINF')
      ? filterAdsFromM3U8Detailed(m3u8Content).content
      : m3u8Content;
    const baseUrl = getBaseUrl(finalUrl);
    const modifiedContent = rewriteM3U8Content(
      filteredContent,
      baseUrl,
      request,
      allowCORS,
      source,
      kind,
      rememberHost
    );

    const headers = new Headers();
    headers.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    // 不再送 Access-Control-Allow-Origin: * ——站內播放為同源請求不需要 CORS；
    // 之前任何第三方網站都能透過訪客瀏覽器讀取代理後的播放清單。
    // 若有可信的跨站播放需求，請改為回傳該來源的 Origin 並限縮方法。
    headers.set('Cache-Control', 'no-cache');

    return new Response(modifiedContent, { headers });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch m3u8' },
      { status: controller.signal.aborted ? 504 : 500 }
    );
  } finally {
    clearTimeout(timeoutId);
    // 確保 response 被正確關閉以釋放資源
    if (response && !responseUsed) {
      try {
        response.body?.cancel();
      } catch (error) {
        // 忽略關閉時的錯誤
        console.warn('Failed to close response body:', error);
      }
    }
  }
}

function rewriteM3U8Content(
  content: string,
  baseUrl: string,
  req: Request,
  allowCORS: boolean,
  source: string | null,
  kind: ProxyKind,
  rememberHost: (fetchedUrl: string) => void
) {
  const { protocol, host } = resolvePublicProxyOrigin(req);
  const sourceParam =
    (source ? `&moontv-source=${encodeURIComponent(source)}` : '') +
    proxyKindQuery(kind);
  const proxyBase = `${protocol}://${host}/api/proxy`;

  const lines = content.split('\n');
  const rewrittenLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // 處理 TS 片段 URL 和其他媒體檔案
    if (line && !line.startsWith('#')) {
      const resolvedUrl = resolveUrl(baseUrl, line);
      // 清單內絕對 URL 可能在別的 CDN host——必須記住，否則 segment 會 403
      rememberHost(resolvedUrl);
      const proxyUrl = allowCORS
        ? resolvedUrl
        : `${proxyBase}/segment?url=${encodeURIComponent(
            resolvedUrl
          )}${sourceParam}`;
      rewrittenLines.push(proxyUrl);
      continue;
    }

    // 處理初始化片段與 Low-Latency HLS 片段標籤中的 URI
    if (
      line.startsWith('#EXT-X-MAP:') ||
      line.startsWith('#EXT-X-PART:') ||
      line.startsWith('#EXT-X-PRELOAD-HINT:')
    ) {
      line = rewriteTagUri(
        line,
        baseUrl,
        proxyBase,
        sourceParam,
        'segment',
        rememberHost
      );
    }

    // 處理媒體清單與主清單的加密金鑰 URI
    if (
      line.startsWith('#EXT-X-KEY:') ||
      line.startsWith('#EXT-X-SESSION-KEY:')
    ) {
      line = rewriteTagUri(
        line,
        baseUrl,
        proxyBase,
        sourceParam,
        'key',
        rememberHost
      );
    }

    // 主清單中的替代音軌、字幕、I-frame 與 LL-HLS 回報都指向另一份清單。
    if (
      line.startsWith('#EXT-X-MEDIA:') ||
      line.startsWith('#EXT-X-I-FRAME-STREAM-INF:') ||
      line.startsWith('#EXT-X-IMAGE-STREAM-INF:') ||
      line.startsWith('#EXT-X-RENDITION-REPORT:')
    ) {
      line = rewriteTagUri(
        line,
        baseUrl,
        proxyBase,
        sourceParam,
        'm3u8',
        rememberHost
      );
    }

    // 處理嵌套的 M3U8 檔案 (EXT-X-STREAM-INF)
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      rewrittenLines.push(line);
      // 下一行通常是 M3U8 URL
      if (i + 1 < lines.length) {
        i++;
        const nextLine = lines[i].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          const resolvedUrl = resolveUrl(baseUrl, nextLine);
          rememberHost(resolvedUrl);
          const proxyUrl = `${proxyBase}/m3u8?url=${encodeURIComponent(
            resolvedUrl
          )}${sourceParam}`;
          rewrittenLines.push(proxyUrl);
        } else {
          rewrittenLines.push(nextLine);
        }
      }
      continue;
    }

    rewrittenLines.push(line);
  }

  return rewrittenLines.join('\n');
}

function rewriteTagUri(
  line: string,
  baseUrl: string,
  proxyBase: string,
  sourceParam: string,
  endpoint: 'segment' | 'key' | 'm3u8',
  rememberHost: (fetchedUrl: string) => void
) {
  const uriMatch = line.match(/\bURI=(["'])(.*?)\1/i);
  if (uriMatch) {
    const quote = uriMatch[1];
    const originalUri = uriMatch[2];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    rememberHost(resolvedUrl);
    const proxyUrl = `${proxyBase}/${endpoint}?url=${encodeURIComponent(
      resolvedUrl
    )}${sourceParam}`;
    return line.replace(uriMatch[0], `URI=${quote}${proxyUrl}${quote}`);
  }
  return line;
}
