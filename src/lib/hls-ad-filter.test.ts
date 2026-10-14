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

  it('removes segments whose URL contains ad keywords', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:6,',
      'https://cdn.example.com/video/seg-1.ts',
      '#EXTINF:6,',
      'https://cdn.example.com/video/adjump/seg-2.ts',
      '#EXTINF:6,',
      'https://cdn.example.com/video/seg-3.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8Detailed(playlist);

    expect(result.removedSegments).toBe(1);
    expect(result.content).toContain('seg-1.ts');
    expect(result.content).toContain('seg-3.ts');
    expect(result.content).not.toContain('adjump');
    // 被移除廣告段的 EXTINF 也要一起拿掉，否則分段數對不上
    expect(result.content.split('#EXTINF').length - 1).toBe(2);
  });

  it('matches ad keywords case-insensitively', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:6,',
      'https://cdn.example.com/ADVERT/seg-1.ts',
      '#EXTINF:6,',
      'https://cdn.example.com/Sponsor/seg-2.ts',
      '#EXTINF:6,',
      'https://cdn.example.com/video/seg-3.ts',
    ].join('\n');

    const result = filterAdsFromM3U8Detailed(playlist);

    expect(result.removedSegments).toBe(2);
    expect(result.content).toContain('seg-3.ts');
    expect(result.content).not.toContain('ADVERT');
    expect(result.content).not.toContain('Sponsor');
  });

  it('removes ad segments with relative URLs and keeps surrounding tags', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6,',
      '#EXT-X-PROGRAM-DATE-TIME:2026-10-02T12:00:00Z',
      'segments/seg-1.ts',
      '#EXTINF:6,',
      '#EXT-X-PROGRAM-DATE-TIME:2026-10-02T12:00:06Z',
      'ads/redtraffic-seg.ts',
      '#EXTINF:6,',
      '#EXT-X-PROGRAM-DATE-TIME:2026-10-02T12:00:12Z',
      'segments/seg-3.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8Detailed(playlist);

    expect(result.removedSegments).toBe(1);
    expect(result.content).not.toContain('redtraffic');
    // 廣告段的 PROGRAM-DATE-TIME 跟著一起移除，正常段的保留
    expect(result.content.split('#EXT-X-PROGRAM-DATE-TIME').length - 1).toBe(2);
    expect(result.content).toContain('#EXT-X-ENDLIST');
  });

  it('does not remove normal segments that merely contain similar substrings', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:6,',
      'https://cdn.example.com/video/adapter-seg-1.ts',
      '#EXTINF:6,',
      'https://cdn.example.com/leadership/seg-2.ts',
      '#EXTINF:6,',
      'https://cdn.example.com/video/seg-3.ts',
    ].join('\n');

    const result = filterAdsFromM3U8Detailed(playlist);

    // adapter 含 "ad" 但不是 "/ad/" 路徑段；leadership 含 "ad" 子字串
    // 都不該被誤刪
    expect(result.removedSegments).toBe(0);
    expect(result.content).toContain('adapter-seg-1.ts');
    expect(result.content).toContain('seg-2.ts');
    expect(result.content).toContain('seg-3.ts');
  });

  it('detects and removes mid-roll ads from foreign ad domain between discontinuities', () => {
    // 模擬 16 個主切片在 cdn.video.com，中途夾了 2 個來自 ad.server.com 的廣告切片
    const mainLines: string[] = [];
    for (let i = 1; i <= 8; i++) {
      mainLines.push('#EXTINF:6,', `https://cdn.video.com/movie/seg-${i}.ts`);
    }

    const midRollAdLines = [
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:5,',
      'https://ad.server.com/promo/ad-1.ts',
      '#EXTINF:5,',
      'https://ad.server.com/promo/ad-2.ts',
      '#EXT-X-DISCONTINUITY',
    ];

    const afterLines: string[] = [];
    for (let i = 9; i <= 16; i++) {
      afterLines.push('#EXTINF:6,', `https://cdn.video.com/movie/seg-${i}.ts`);
    }

    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      ...mainLines,
      ...midRollAdLines,
      ...afterLines,
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8Detailed(playlist);

    expect(result.removedSegments).toBe(2);
    expect(result.content).not.toContain('ad.server.com');
    expect(result.content).toContain('seg-1.ts');
    expect(result.content).toContain('seg-16.ts');
    expect(result.content).toContain('#EXT-X-ENDLIST');
  });

  it('detects and removes mid-roll ads using guanggao and ts-ad patterns', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:6,',
      'https://cdn.video.com/seg-1.ts',
      '#EXTINF:6,',
      'https://cdn.video.com/guanggao/ad01.ts',
      '#EXTINF:6,',
      'https://cdn.video.com/cache-ad/ts-ad-02.ts',
      '#EXTINF:6,',
      'https://cdn.video.com/seg-2.ts',
    ].join('\n');

    const result = filterAdsFromM3U8Detailed(playlist);

    expect(result.removedSegments).toBe(2);
    expect(result.content).not.toContain('guanggao');
    expect(result.content).not.toContain('cache-ad');
    expect(result.content).toContain('seg-1.ts');
    expect(result.content).toContain('seg-2.ts');
  });

  it('removes mid-roll discontinuity island with different path prefix', () => {
    // 16 個主切片在 /2026/ep1/，中途被 /adv/ 夾擊
    const mainLines: string[] = [];
    for (let i = 1; i <= 8; i++) {
      mainLines.push(
        '#EXTINF:6,',
        `https://cdn.video.com/2026/ep1/seg-${i}.ts`
      );
    }
    const adIsland = [
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:4.5,',
      'https://cdn.video.com/ads/sponsor_promo_1.ts',
      '#EXTINF:4.5,',
      'https://cdn.video.com/ads/sponsor_promo_2.ts',
      '#EXT-X-DISCONTINUITY',
    ];
    const afterLines: string[] = [];
    for (let i = 9; i <= 16; i++) {
      afterLines.push(
        '#EXTINF:6,',
        `https://cdn.video.com/2026/ep1/seg-${i}.ts`
      );
    }

    const playlist = [
      '#EXTM3U',
      ...mainLines,
      ...adIsland,
      ...afterLines,
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8Detailed(playlist);
    expect(result.removedSegments).toBe(2);
    expect(result.content).not.toContain('sponsor_promo');
    expect(result.content).toContain('seg-1.ts');
    expect(result.content).toContain('seg-16.ts');
  });
});
