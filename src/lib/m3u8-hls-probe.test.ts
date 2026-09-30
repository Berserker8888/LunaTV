/**
 * @jest-environment jsdom
 */
import { probeM3u8ByHls } from './m3u8-hls-probe';

jest.mock(
  'hls.js',
  () => ({
    __esModule: true,
    default: class FakeHls {
      static isSupported() {
        return true;
      }
      on() {}
      loadSource() {}
      attachMedia() {}
      destroy() {}
    },
  }),
  { virtual: true }
);

describe('probeM3u8ByHls 預先取消', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // 探測會發 HEAD 請求量 ping：單元測試不打真實網路，改為永遠掛住
    global.fetch = jest.fn(
      () => new Promise<Response>(() => {})
    ) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('signal 預先已取消時以 AbortError 拒絕，而非 TDZ ReferenceError', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      probeM3u8ByHls('https://example.com/list.m3u8', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('探測中途取消時以 AbortError 拒絕', async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = probeM3u8ByHls(
        'https://example.com/list.m3u8',
        controller.signal
      );
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'AbortError',
      });
      controller.abort();
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
