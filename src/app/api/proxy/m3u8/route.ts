import { NextResponse } from 'next/server';

import { filterAdsFromM3U8Detailed } from '@/lib/hls-ad-filter';
import { getBaseUrl } from '@/lib/live';
import { rewriteM3U8Content } from '@/lib/m3u8-rewrite';
import { authorizeProxyFetch } from '@/lib/proxy-access';
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
