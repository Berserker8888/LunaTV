import {
  rollbackOptimisticArray,
  rollbackOptimisticKey,
} from './optimistic-rollback';

describe('rollbackOptimisticKey', () => {
  it('目前仍是樂觀值時，還原成舊值', () => {
    const commit = jest.fn();
    const latest = { a: { v: 2 }, b: { v: 9 } };
    const ok = rollbackOptimisticKey(latest, 'a', { v: 2 }, { v: 1 }, commit);

    expect(ok).toBe(true);
    expect(commit).toHaveBeenCalledWith({ a: { v: 1 }, b: { v: 9 } });
  });

  it('舊值不存在時，還原即刪除該 key', () => {
    const commit = jest.fn();
    const latest = { a: { v: 2 } };
    const ok = rollbackOptimisticKey(latest, 'a', { v: 2 }, undefined, commit);

    expect(ok).toBe(true);
    expect(commit).toHaveBeenCalledWith({});
  });

  it('該 key 已被後續寫入動過時，不還原（避免蓋掉較新資料）', () => {
    const commit = jest.fn();
    const latest = { a: { v: 3 } }; // 失敗後又有一次成功寫入
    const ok = rollbackOptimisticKey(latest, 'a', { v: 2 }, { v: 1 }, commit);

    expect(ok).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('rollbackOptimisticArray', () => {
  it('陣列仍是樂觀寫入的樣子時，還原成舊陣列', () => {
    const commit = jest.fn();
    const ok = rollbackOptimisticArray(['b', 'a'], ['b', 'a'], ['a'], commit);

    expect(ok).toBe(true);
    expect(commit).toHaveBeenCalledWith(['a']);
  });

  it('陣列已被後續搜尋動過時，不還原', () => {
    const commit = jest.fn();
    const ok = rollbackOptimisticArray(
      ['c', 'b', 'a'], // 之後又有新搜尋加入
      ['b', 'a'],
      ['a'],
      commit
    );

    expect(ok).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });
});
