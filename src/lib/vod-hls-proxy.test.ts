import {
  buildCorsApiM3u8Url,
  buildVodHlsProxyUrl,
  detectVodTransport,
  getCorsApiOrigin,
  isCorsApiM3u8Url,
  isVodHlsProxyUrl,
  nextVodTransportOnNetworkError,
  resolveVodPlaybackUrl,
  shouldFallbackToVodProxy,
} from './vod-hls-proxy';

describe('vod hls proxy url', () => {
  it('builds an authenticated same-origin proxy URL', () => {
    const url = buildVodHlsProxyUrl(
      'https://cdn.example/ep1.m3u8?token=1',
      'guangsu'
    );
    expect(url.startsWith('/api/proxy/m3u8?')).toBe(true);
    const parsed = new URL(url, 'http://lunatv.invalid');
    expect(parsed.searchParams.get('url')).toBe(
      'https://cdn.example/ep1.m3u8?token=1'
    );
    expect(parsed.searchParams.get('moontv-source')).toBe('guangsu');
    expect(parsed.searchParams.get('kind')).toBe('vod');
    expect(isVodHlsProxyUrl(url)).toBe(true);
  });

  it('does not treat live proxy URLs as VOD fallback', () => {
    expect(
      isVodHlsProxyUrl(
        '/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Flive.m3u8&moontv-source=iptv'
      )
    ).toBe(false);
    expect(isVodHlsProxyUrl('https://cdn.example/ep1.m3u8')).toBe(false);
  });

  it('only falls back once, and only on network errors', () => {
    expect(shouldFallbackToVodProxy('networkError', false)).toBe(true);
    expect(shouldFallbackToVodProxy('networkError', true)).toBe(false);
    expect(shouldFallbackToVodProxy('mediaError', false)).toBe(false);
  });
});

describe('corsapi m3u8 fallback', () => {
  it('builds a worker m3u8 URL from origin only', () => {
    const url = buildCorsApiM3u8Url(
      'https://pz.example.com/extra',
      'https://cdn.example/ep1.m3u8?token=1'
    );
    expect(url).toBe(
      'https://pz.example.com/m3u8?url=' +
        encodeURIComponent('https://cdn.example/ep1.m3u8?token=1')
    );
    expect(isCorsApiM3u8Url(url)).toBe(true);
    expect(detectVodTransport(url)).toBe('corsapi');
  });

  it('prefers localStorage origin over runtime config', () => {
    expect(
      getCorsApiOrigin(
        { CORSAPI_ORIGIN: 'https://runtime.example' },
        { getItem: () => 'https://stored.example/path' },
        'https://env.example'
      )
    ).toBe('https://stored.example');
    expect(
      getCorsApiOrigin(
        { CORSAPI_ORIGIN: 'https://runtime.example' },
        null,
        null
      )
    ).toBe('https://runtime.example');
  });

  it('rejects credentials in the worker origin', () => {
    expect(
      getCorsApiOrigin(undefined, {
        getItem: () => 'https://user:pass@evil.test',
      })
    ).toBeNull();
  });

  it('resolves direct → corsapi → station URLs', () => {
    const direct = 'https://cdn.example/ep1.m3u8';
    expect(
      resolveVodPlaybackUrl({
        directUrl: direct,
        sourceKey: 'guangsu',
        transport: 'direct',
        corsApiOrigin: 'https://pz.example.com',
      })
    ).toBe(direct);
    expect(
      resolveVodPlaybackUrl({
        directUrl: direct,
        sourceKey: 'guangsu',
        transport: 'corsapi',
        corsApiOrigin: 'https://pz.example.com',
      })
    ).toContain('/m3u8?url=');
    expect(
      resolveVodPlaybackUrl({
        directUrl: direct,
        sourceKey: 'guangsu',
        transport: 'station',
        corsApiOrigin: 'https://pz.example.com',
      })
    ).toContain('/api/proxy/m3u8?');
  });

  it('skips corsapi and uses station when no worker origin is set', () => {
    expect(nextVodTransportOnNetworkError('direct', false)).toBe('station');
    expect(nextVodTransportOnNetworkError('direct', true)).toBe('corsapi');
    expect(nextVodTransportOnNetworkError('corsapi', true)).toBe('station');
    expect(nextVodTransportOnNetworkError('station', true)).toBeNull();
  });
});
