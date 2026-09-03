/** @jest-environment node */

import { resolvePublicProxyOrigin } from './proxy-public-origin';

function makeRequest(
  url: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, { headers });
}

describe('resolvePublicProxyOrigin', () => {
  it('ignores forwarded headers unless TRUST_PROXY is on', () => {
    const origin = resolvePublicProxyOrigin(
      makeRequest('http://192.168.1.8:3000/api/proxy/m3u8', {
        host: '192.168.1.8:3000',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example',
      }),
      {}
    );
    expect(origin).toEqual({ protocol: 'http', host: '192.168.1.8:3000' });
  });

  it('uses forwarded proto/host when TRUST_PROXY is enabled', () => {
    const origin = resolvePublicProxyOrigin(
      makeRequest('http://127.0.0.1:3000/api/proxy/m3u8', {
        host: '127.0.0.1:3000',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'tv.example.com',
      }),
      { TRUST_PROXY: 'true' }
    );
    expect(origin).toEqual({ protocol: 'https', host: 'tv.example.com' });
  });
});
