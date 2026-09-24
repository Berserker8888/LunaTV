import { filterAdsFromM3U8Detailed } from './hls-ad-filter';

describe('filterAdsFromM3U8Detailed', () => {
  it('keeps the playlist end marker when an ad break never closes', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-CUE-OUT:30',
      '#EXTINF:6,',
      'ad.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8Detailed(playlist);

    expect(result.removedSegments).toBe(1);
    expect(result.content).toContain('#EXT-X-ENDLIST');
    expect(result.content).not.toContain('ad.ts');
  });

  it('keeps a program discontinuity and still removes the ad segment', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-CUE-OUT:30',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:6,',
      'ad.ts',
      '#EXT-X-CUE-IN',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:6,',
      'show.ts',
    ].join('\n');

    const result = filterAdsFromM3U8Detailed(playlist);

    expect(result.removedSegments).toBe(1);
    expect(result.content).toContain('show.ts');
    expect(result.content).not.toContain('ad.ts');
    expect(result.content.split('#EXT-X-DISCONTINUITY').length - 1).toBe(1);
  });
});
