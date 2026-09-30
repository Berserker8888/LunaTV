/**
 * @jest-environment node
 */
import { rewriteM3U8Content } from './m3u8-rewrite';

function makeReq() {
  return new Request('https://video.example.com/api/proxy/m3u8?url=x');
}

describe('rewriteM3U8Content EXT-X-STREAM-INF', () => {
  it('下一行是 URI 時走 m3u8 代理', () => {
    const out = rewriteM3U8Content(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow.m3u8',
      'https://cdn.example.com/list/',
      makeReq(),
      false,
      'src1',
      'vod',
      () => {}
    );
    expect(out).toContain('/api/proxy/m3u8?url=');
    expect(out).toContain(
      encodeURIComponent('https://cdn.example.com/list/low.m3u8')
    );
  });

  it('下一行是標籤時不消費：標籤照常處理、其後的 URI 仍走 m3u8 代理', () => {
    const remembered: string[] = [];
    const out = rewriteM3U8Content(
      '#EXTM3U\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
        '#EXT-X-SESSION-DATA:DATA-ID="x"\n' +
        'low.m3u8',
      'https://cdn.example.com/list/',
      makeReq(),
      false,
      'src1',
      'vod',
      (u: string) => remembered.push(u)
    );
    const lines = out.split('\n');
    // 標籤行保留
    expect(lines).toContain('#EXT-X-SESSION-DATA:DATA-ID="x"');
    // URI 行走 m3u8 代理（不是 segment）
    const uriLine = lines.find((l) => l.includes('low.m3u8'));
    expect(uriLine).toContain('/api/proxy/m3u8?url=');
    expect(uriLine).not.toContain('/api/proxy/segment?url=');
    expect(remembered).toContain('https://cdn.example.com/list/low.m3u8');
  });

  it('STREAM-INF 後直接是 KEY 標籤：KEY 的 URI 也被重寫', () => {
    const out = rewriteM3U8Content(
      '#EXTM3U\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n' +
        'low.m3u8',
      'https://cdn.example.com/list/',
      makeReq(),
      false,
      'src1',
      'vod',
      () => {}
    );
    // KEY 的 URI 必須走 key 代理，不能原樣透出
    expect(out).toContain('/api/proxy/key?url=');
    expect(out).not.toContain('URI="key.bin"');
  });
});
