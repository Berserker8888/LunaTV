import { ReadableStream } from 'node:stream/web';

import type { ApiSite } from '@/lib/config';

import { validateSourceSite } from './source-validation';

jest.mock('@/lib/url-safety', () => {
  const actual = jest.requireActual('@/lib/url-safety');
  return {
    ...actual,
    // 永遠不回應、只在 signal 取消時拒絕：模擬上游無限掛住
    fetchSafeRemoteUrl: jest.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    ),
  };
});

const site: ApiSite = {
  key: 'test-src',
  name: '測試源',
  api: 'https://example.com/api.php/provide/vod/',
};

/**
 * 最小假 Response：readResponseJsonWithLimit 只用 headers.get() 與
 * body.getReader()。不用 undici 的 Response——它的 body stream 在
 * jest fake timers 下第二個 read() 永遠不回 done，會把測試掛住。
 */
function fakeJsonResponse(data: unknown, status = 200): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    body,
  } as unknown as Response;
}

describe('validateSourceSite 搜尋超時', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('上游無限掛住時，searchTimeoutMs 到期即中斷並回報搜尋失敗', async () => {
    const pending = validateSourceSite(site, {
      keyword: '測試',
      searchTimeoutMs: 1000,
      probePlayback: false,
    });
    const assertion = expect(pending).resolves.toMatchObject({
      status: 'invalid',
      message: '搜尋連線失敗',
    });
    // 推進計時器觸發 AbortController 超時
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('上游及時回應時不受超時影響', async () => {
    const { fetchSafeRemoteUrl } = jest.requireMock('@/lib/url-safety');
    fetchSafeRemoteUrl.mockResolvedValueOnce(
      fakeJsonResponse({ list: [] }, 200)
    );

    const pending = validateSourceSite(site, {
      keyword: '測試',
      searchTimeoutMs: 1000,
      probePlayback: false,
    });
    await expect(pending).resolves.toMatchObject({
      status: 'no_results',
    });
  });
});
