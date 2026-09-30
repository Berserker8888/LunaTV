import { getBaseUrl, parseM3U } from './live';

describe('getBaseUrl', () => {
  it('drops the playlist file instead of appending a slash to it', () => {
    expect(getBaseUrl('https://cdn.example/live/index.m3u8?token=1')).toBe(
      'https://cdn.example/live/'
    );
    expect(getBaseUrl('https://cdn.example/live/index.m3u')).toBe(
      'https://cdn.example/live/'
    );
    expect(getBaseUrl('https://cdn.example/live/playlist')).toBe(
      'https://cdn.example/live/'
    );
    expect(getBaseUrl('https://cdn.example/live/dir/')).toBe(
      'https://cdn.example/live/dir/'
    );
  });
});

describe('parseM3U', () => {
  it('keeps commas in the display name and resolves relative urls', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-name="News",CNN, HD',
      'channel.ts',
    ].join('\n');
    const parsed = parseM3U(
      'src',
      playlist,
      'https://cdn.example/lists/channels.m3u'
    );

    expect(parsed.channels).toHaveLength(1);
    expect(parsed.channels[0]?.name).toBe('CNN, HD');
    expect(parsed.channels[0]?.url).toBe(
      'https://cdn.example/lists/channel.ts'
    );
  });

  it('resolves a relative tvg-url against the playlist url', () => {
    const playlist = [
      '#EXTM3U x-tvg-url="epg/guide.xml"',
      '#EXTINF:-1 tvg-id="c1",CH1',
      'https://cdn.example/stream/ch1.m3u8',
    ].join('\n');
    const parsed = parseM3U(
      'src',
      playlist,
      'https://cdn.example/lists/channels.m3u'
    );

    expect(parsed.tvgUrl).toBe('https://cdn.example/lists/epg/guide.xml');
  });

  it('keeps an absolute tvg-url untouched', () => {
    const playlist = [
      '#EXTM3U x-tvg-url="https://epg.example/guide.xml"',
      '#EXTINF:-1 tvg-id="c1",CH1',
      'https://cdn.example/stream/ch1.m3u8',
    ].join('\n');
    const parsed = parseM3U(
      'src',
      playlist,
      'https://cdn.example/lists/channels.m3u'
    );

    expect(parsed.tvgUrl).toBe('https://epg.example/guide.xml');
  });
});
