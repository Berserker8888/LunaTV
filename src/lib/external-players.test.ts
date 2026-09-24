import {
  buildExternalPlayerHref,
  isDirectPlayableUrl,
} from './external-players';

const PLAY_URL = 'https://cdn.example/show/1.m3u8?token=a+b';

describe('external players', () => {
  it('only accepts http and https play urls', () => {
    expect(isDirectPlayableUrl(PLAY_URL)).toBe(true);
    expect(isDirectPlayableUrl('javascript:alert(1)')).toBe(false);
    expect(isDirectPlayableUrl('/api/proxy/m3u8')).toBe(false);
  });

  it('builds player links from the direct url', () => {
    expect(buildExternalPlayerHref('copy', PLAY_URL)).toBeNull();
    expect(buildExternalPlayerHref('iina', PLAY_URL)).toBe(
      `iina://weblink?url=${encodeURIComponent(PLAY_URL)}`
    );
    expect(buildExternalPlayerHref('potplayer', PLAY_URL)).toBe(
      `potplayer://${PLAY_URL}`
    );
    expect(buildExternalPlayerHref('vlc', 'javascript:alert(1)')).toBeNull();
  });
});
