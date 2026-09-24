import { fetchBangumiJson } from './bangumi-upstream';

function jsonResponse(body: string, status: number): Response {
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    body: {
      cancel: async () => undefined,
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        },
        cancel: async () => undefined,
      }),
    },
  } as unknown as Response;
}

describe('fetchBangumiJson', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses the mirror when the official api fails and does not send the token there', async () => {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    global.fetch = jest.fn(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({ url, authorization: headers.get('authorization') });
      if (url.startsWith('https://api.bgm.tv')) {
        return jsonResponse('upstream down', 502);
      }
      return jsonResponse(JSON.stringify([{ id: 1 }]), 200);
    }) as typeof fetch;

    const result = await fetchBangumiJson<Array<{ id: number }>>('calendar', {
      timeoutMs: 1000,
      maxBytes: 1024 * 1024,
      headersFor: (origin): Record<string, string> =>
        origin === 'https://api.bgm.tv'
          ? { Authorization: 'Bearer secret' }
          : { Accept: 'application/json' },
      parse: (value) => (Array.isArray(value) ? value : null),
    });

    expect(result).toEqual({ status: 'ok', data: [{ id: 1 }] });
    expect(seen.map((item) => item.url)).toEqual([
      'https://api.bgm.tv/calendar',
      'https://api.bangumi.lol/calendar',
    ]);
    expect(seen[0]?.authorization).toBe('Bearer secret');
    expect(seen[1]?.authorization).toBeNull();
  });

  it('asks the mirror after an official 404 and stops only when every origin is missing', async () => {
    const fetchMock = jest.fn(async () => jsonResponse('missing', 404));
    global.fetch = fetchMock as typeof fetch;

    const result = await fetchBangumiJson('v0/subjects/1', {
      timeoutMs: 1000,
      maxBytes: 1024,
      headersFor: () => ({}),
      parse: () => null,
    });

    expect(result.status).toBe('not-found');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
