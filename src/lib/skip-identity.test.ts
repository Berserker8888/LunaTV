import {
  extractVersionTag,
  makeSkipIdentityKey,
  makeSkipIdentityParts,
  SKIP_IDENTITY_SOURCE,
} from './skip-identity';
import { generateStorageKey } from './storage-key';

describe('skip identity', () => {
  it('prefers douban id over title', () => {
    expect(
      makeSkipIdentityParts({
        doubanId: 1296698,
        title: '海賊王',
        year: '1999',
      })
    ).toEqual({ source: SKIP_IDENTITY_SOURCE, id: 'd1296698' });
  });

  it('same title and year share a key across sources', () => {
    const a = makeSkipIdentityKey({ title: '海賊王', year: '1999' });
    const b = makeSkipIdentityKey({ title: '海 賊 王', year: 1999 });
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(a?.startsWith(`${SKIP_IDENTITY_SOURCE}+t`)).toBe(true);
  });

  it('different titles do not share a key', () => {
    expect(makeSkipIdentityKey({ title: '海賊王', year: '1999' })).not.toBe(
      makeSkipIdentityKey({ title: '火影忍者', year: '1999' })
    );
  });

  it('produces storage keys the skip API will accept', () => {
    const key = makeSkipIdentityKey({ doubanId: 1296698 });
    expect(key).toBe(generateStorageKey(SKIP_IDENTITY_SOURCE, 'd1296698'));
  });

  it('同一豆瓣 ID 的不同剪輯版本不共用秒數', () => {
    const normal = makeSkipIdentityParts({
      doubanId: 1296698,
      title: '沙丘2',
      year: '2024',
    });
    const director = makeSkipIdentityParts({
      doubanId: 1296698,
      title: '沙丘2 導演剪輯版',
      year: '2024',
    });
    const extended = makeSkipIdentityParts({
      doubanId: 1296698,
      title: '沙丘2加長版',
      year: '2024',
    });
    // 無版本詞維持舊 id，已存的設定不受影響
    expect(normal?.id).toBe('d1296698');
    expect(director?.id).not.toBe('d1296698');
    expect(extended?.id).not.toBe('d1296698');
    expect(director?.id).not.toBe(extended?.id);
    // 同一版本在不同寫法下穩定
    expect(
      makeSkipIdentityParts({
        doubanId: 1296698,
        title: '沙丘2導演剪輯版',
        year: '2024',
      })?.id
    ).toBe(director?.id);
  });

  it('extractVersionTag 抓得到常見版本詞', () => {
    expect(extractVersionTag('電影名 劇場版')).toBe('劇場版');
    expect(extractVersionTag('電影名')).toBe('');
    expect(extractVersionTag(null)).toBe('');
  });
});
