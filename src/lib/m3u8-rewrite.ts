import { resolveUrl } from '@/lib/live';
import { type ProxyKind, proxyKindQuery } from '@/lib/proxy-access';
import { resolvePublicProxyOrigin } from '@/lib/proxy-public-origin';

/** m3u8 播放清單 URI 重寫（EXT-X-STREAM-INF 巢狀清單等）。route.ts 與測試共用。 */
export function rewriteM3U8Content(
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

  // EXT-X-STREAM-INF 的下一行「應該」是變體清單 URI；非標準清單可能在中間
  // 插入標籤行（如 SESSION-DATA）。用旗標記住「下一個非標籤行才是 URI」，
  // 而不是直接 i++ 消費下一行——否則中間的標籤會被跳過，其 URI 沒被重寫。
  let expectVariantUri = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // 處理 TS 片段 URL 和其他媒體檔案；EXT-X-STREAM-INF 之後的第一個
    // 非標籤行是變體清單，走 m3u8 代理。
    if (line && !line.startsWith('#')) {
      const resolvedUrl = resolveUrl(baseUrl, line);
      // 清單內絕對 URL 可能在別的 CDN host——必須記住，否則 segment 會 403
      rememberHost(resolvedUrl);
      const isVariantUri = expectVariantUri;
      expectVariantUri = false;
      const proxyUrl =
        !isVariantUri && allowCORS
          ? resolvedUrl
          : `${proxyBase}/${isVariantUri ? 'm3u8' : 'segment'}?url=${encodeURIComponent(
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

    // 處理嵌套的 M3U8 檔案 (EXT-X-STREAM-INF)：只記下「期待變體 URI」，
    // 下一個非標籤行由迴圈開頭統一處理。中間若有標籤行會走正常標籤流程
    //（URI 照樣重寫），不會被吞掉。
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      rewrittenLines.push(line);
      expectVariantUri = true;
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
