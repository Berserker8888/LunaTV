import { lookup } from 'node:dns/promises';
import { ReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

import {
  BLOCKED_SUBNETS,
  fetchSafeRemoteUrl,
  getSafeImageContentType,
  isBlockedAddress,
  parseSafeRemoteUrl,
  readResponseBytesWithLimit,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from './url-safety';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockAgentOptions: Array<{
  connect: {
    lookup: (
      hostname: string,
      options: { all?: boolean },
      callback: (
        err: Error | null,
        result: Array<{ address: string; family: number }>
      ) => void
    ) => void;
  };
}> = [];

jest.mock('undici', () => ({
  Agent: class {
    constructor(opts: (typeof mockAgentOptions)[number]) {
      mockAgentOptions.push(opts);
    }
    close() {
      return Promise.resolve();
    }
  },
}));

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

Object.defineProperty(globalThis, 'TextDecoder', {
  configurable: true,
  value: TextDecoder,
});

function createTextResponse(text: string): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return {
    body,
    headers: { get: () => null },
  } as unknown as Response;
}

describe('url safety helpers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      body: null,
      headers: { get: jest.fn() },
      ok: true,
      status: 200,
    } as unknown as Response);
  });

  it('rejects obvious local and private URLs before fetching', async () => {
    expect(parseSafeRemoteUrl('http://127.0.0.1:3000/a.m3u8')).toBeNull();
    expect(parseSafeRemoteUrl('file:///etc/passwd')).toBeNull();

    await expect(fetchSafeRemoteUrl('http://localhost/a.m3u8')).rejects.toThrow(
      'Unsafe remote URL'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    mockedLookup.mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await expect(
      fetchSafeRemoteUrl('https://private.example.com/live.m3u8')
    ).rejects.toThrow('Unsafe resolved remote address');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects hexadecimal IPv4-mapped loopback addresses', async () => {
    // 同步預檢（parseSafeRemoteUrl）先擋掉，錯誤訊息是預設的 Unsafe remote URL
    await expect(
      fetchSafeRemoteUrl('http://[::ffff:7f00:1]/private')
    ).rejects.toThrow('Unsafe remote URL');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(['fe80::1', 'fe90::1', 'fea0::1', 'febf::1'])(
    'rejects IPv6 link-local literal %s',
    (address) => {
      expect(parseSafeRemoteUrl(`http://[${address}]/private`)).toBeNull();
    }
  );

  it('rejects hostnames that resolve anywhere inside fe80::/10', async () => {
    mockedLookup.mockResolvedValue([
      { address: 'fe9f::1234', family: 6 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await expect(
      fetchSafeRemoteUrl('https://ipv6-link-local.example.com/private')
    ).rejects.toThrow('Unsafe resolved remote address');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('allows hostnames that resolve to public addresses', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    const response = await fetchSafeRemoteUrl('https://example.com/live.m3u8');

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/live.m3u8',
      expect.objectContaining({
        redirect: 'manual',
        dispatcher: expect.anything(),
      })
    );
  });

  it('pins the validated DNS result into the outbound dispatcher', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await fetchSafeRemoteUrl('https://pinned.example.com/video');

    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://pinned.example.com/video',
      expect.objectContaining({ dispatcher: expect.anything() })
    );
  });

  it('orders vetted addresses IPv4-first so hosts without IPv6 egress can connect', async () => {
    mockedLookup.mockResolvedValue([
      { address: '2606:4700:3034::ac43:a42f', family: 6 },
      { address: '104.21.41.102', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await fetchSafeRemoteUrl('https://dual-stack.example.com/api');

    const opts = mockAgentOptions[mockAgentOptions.length - 1];
    const addresses = await new Promise<
      Array<{ address: string; family: number }>
    >((resolve, reject) => {
      opts.connect.lookup(
        'dual-stack.example.com',
        { all: true },
        (err, result) => (err ? reject(err) : resolve(result))
      );
    });

    expect(addresses.map((a) => a.family)).toEqual([4, 6]);
    expect(addresses[0].address).toBe('104.21.41.102');
  });

  it('caches safe DNS results to avoid repeated lookups for media segments', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await fetchSafeRemoteUrl('https://cdn.example.com/segment-1.ts');
    await fetchSafeRemoteUrl('https://cdn.example.com/segment-2.ts');

    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('reads bounded response text and rejects oversized bodies', async () => {
    await expect(
      readResponseTextWithLimit(createTextResponse('small'), 10)
    ).resolves.toBe('small');
    await expect(
      readResponseTextWithLimit(createTextResponse('too large'), 4)
    ).rejects.toThrow('exceeds 4 bytes');
  });

  it('reads bounded binary responses and rejects oversized bodies', async () => {
    await expect(
      readResponseBytesWithLimit(createTextResponse('small'), 10).then(
        Array.from
      )
    ).resolves.toEqual(Array.from(new TextEncoder().encode('small')));
    await expect(
      readResponseBytesWithLimit(createTextResponse('too large'), 4)
    ).rejects.toThrow('exceeds 4 bytes');
  });

  it('parses bounded JSON and rejects oversized JSON bodies', async () => {
    await expect(
      readResponseJsonWithLimit<{ ok: boolean }>(
        createTextResponse('{"ok":true}'),
        20
      )
    ).resolves.toEqual({ ok: true });
    await expect(
      readResponseJsonWithLimit(createTextResponse('{"ok":true}'), 4)
    ).rejects.toThrow('exceeds 4 bytes');
  });

  /**
   * dns.lookup 走 libuv 執行緒池（預設 4 條）且不吃 AbortSignal，呼叫端的
   * AbortController 完全管不到它。慢速或無回應的解析器會佔滿執行緒池，
   * 連帶拖垮同行程的檔案 I/O、gzip 與 scrypt。以下三條把防護釘死。
   */
  describe('DNS 解析的執行緒池防護', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('同一主機名的並發查詢只實際解析一次', async () => {
      mockedLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
      ] as unknown as Awaited<ReturnType<typeof lookup>>);

      await Promise.all([
        fetchSafeRemoteUrl('https://dedupe-probe.example.com/1.m3u8'),
        fetchSafeRemoteUrl('https://dedupe-probe.example.com/2.m3u8'),
        fetchSafeRemoteUrl('https://dedupe-probe.example.com/3.m3u8'),
      ]);

      expect(mockedLookup).toHaveBeenCalledTimes(1);
    });

    it('解析卡住時會逾時，不會無限期等待', async () => {
      jest.useFakeTimers();
      mockedLookup.mockReturnValue(
        new Promise(() => undefined) as ReturnType<typeof lookup>
      );

      const pending = fetchSafeRemoteUrl('https://hung-dns.example.com/1.m3u8');
      const assertion = expect(pending).rejects.toThrow(
        'Unable to resolve remote host'
      );
      await jest.advanceTimersByTimeAsync(5000);
      await assertion;

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('解析失敗會進負面快取，死掉的主機不會每次都再賠一次逾時', async () => {
      mockedLookup.mockRejectedValue(new Error('ENOTFOUND'));

      await expect(
        fetchSafeRemoteUrl('https://dead-host-probe.example.com/1.m3u8')
      ).rejects.toThrow('Unable to resolve remote host');
      await expect(
        fetchSafeRemoteUrl('https://dead-host-probe.example.com/2.m3u8')
      ).rejects.toThrow('Unable to resolve remote host');

      expect(mockedLookup).toHaveBeenCalledTimes(1);
    });
  });
});

describe('getSafeImageContentType', () => {
  it('allows real image types and rejects generic binaries', () => {
    expect(getSafeImageContentType('image/png')).toBe('image/png');
    expect(getSafeImageContentType('image/jpeg; charset=binary')).toBe(
      'image/jpeg'
    );
    expect(getSafeImageContentType('application/octet-stream')).toBeNull();
    expect(getSafeImageContentType('text/html')).toBeNull();
  });
});

describe('isBlockedAddress（BlockList 資料表驅動）', () => {
  // 每條子網規則一個代表位址，確保規則真的有裝進 BlockList
  const BLOCKED_SAMPLES: Record<string, string> = {
    '0.0.0.0/8': '0.0.0.1',
    '10.0.0.0/8': '10.1.2.3',
    '100.64.0.0/10': '100.64.0.1',
    '127.0.0.0/8': '127.0.0.1',
    '169.254.0.0/16': '169.254.10.20',
    '172.16.0.0/12': '172.16.5.4',
    '192.168.0.0/16': '192.168.1.1',
    '198.18.0.0/15': '198.18.0.1',
    '::/128': '::',
    '::1/128': '::1',
    '::/96': '::7f00:1',
    'fc00::/7': 'fc00::1',
    'fe80::/10': 'fe80::1',
    'ff00::/8': 'ff02::1',
  };

  it('資料表的每條規則都有對應的測試樣本', () => {
    const keys = new Set(BLOCKED_SUBNETS.map((r) => `${r.subnet}/${r.prefix}`));
    for (const key of Object.keys(BLOCKED_SAMPLES)) {
      expect(keys.has(key)).toBe(true);
    }
    expect(keys.size).toBe(Object.keys(BLOCKED_SAMPLES).length);
  });

  it.each(Object.entries(BLOCKED_SAMPLES))(
    '擋掉 %s 的樣本 %s',
    (_cidr, sample) => {
      expect(isBlockedAddress(sample)).toBe(true);
    }
  );

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '2001:db8::1',
    '2606:4700:4700::1111',
  ])('放行公網位址 %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(false);
  });

  it.each(['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3'])(
    '擋掉 IPv4-mapped %s（BlockList 自動對應）',
    (addr) => {
      expect(isBlockedAddress(addr)).toBe(true);
    }
  );

  it('放行 IPv4-mapped 的公網位址', () => {
    expect(isBlockedAddress('::ffff:0808:0808')).toBe(false);
  });

  it('localhost 字串照樣擋', () => {
    expect(isBlockedAddress('localhost')).toBe(true);
    expect(isBlockedAddress('LOCALHOST')).toBe(true);
  });

  it('NAT64 只看內嵌 IPv4：內嵌私網就擋，內嵌公網就放', () => {
    // 64:ff9b::7f00:1 內嵌 127.0.0.1 → 擋
    expect(isBlockedAddress('64:ff9b::7f00:1')).toBe(true);
    // 64:ff9b::0808:0808 內嵌 8.8.8.8 → 放行（整段封會打壞 IPv6-only 主機）
    expect(isBlockedAddress('64:ff9b::0808:0808')).toBe(false);
  });

  it('parseSafeRemoteUrl 對字面 IP 做同步預檢', () => {
    expect(parseSafeRemoteUrl('http://127.0.0.1/x.m3u8')).toBeNull();
    expect(parseSafeRemoteUrl('http://[::ffff:10.0.0.1]/x.m3u8')).toBeNull();
    expect(parseSafeRemoteUrl('http://localhost:3000/x')).toBeNull();
    expect(parseSafeRemoteUrl('https://example.com/x.m3u8')).not.toBeNull();
  });
});
