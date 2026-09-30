import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { authorizeProxyFetch } from '@/lib/proxy-access';
import {
  fetchSafeRemoteUrl,
  readResponseBytesWithLimit,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const KEY_FETCH_TIMEOUT_MS = 10000;
const MAX_KEY_BYTES = 1024 * 1024;

export async function GET(request: Request) {
  const access = await authorizeProxyFetch(request, 'key');
  if (!access.ok) return access.response;

  const { url, fetchHeaders } = access;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KEY_FETCH_TIMEOUT_MS);

  try {
    logger.debug('Proxy key request:', url);
    const response = await fetchSafeRemoteUrl(url, {
      headers: fetchHeaders,
      signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel();
      return NextResponse.json(
        { error: 'Failed to fetch key' },
        { status: 500 }
      );
    }
    const keyData = await readResponseBytesWithLimit(response, MAX_KEY_BYTES);
    // 預設不送 Access-Control-Allow-Origin（與 m3u8 代理一致）：站內播放為
    // 同源請求不需要 CORS；之前任何網站的 JS 都能跨域讀取金鑰。
    // 僅在管理員以環境變數明確允許跨站播放時才送。
    const keyHeaders: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      // 金鑰端點需登入：private 避免共用快取以 URL 為鍵存下金鑰、
      // 未登入者命中快取即繞過登入。金鑰很小，直接 no-store。
      'Cache-Control': 'private, no-store',
    };
    if (process.env.PROXY_ALLOW_CORS === 'true') {
      keyHeaders['Access-Control-Allow-Origin'] = '*';
    }
    return new Response(keyData, { headers: keyHeaders });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch key' },
      { status: controller.signal.aborted ? 504 : 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
