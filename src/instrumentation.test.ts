/**
 * 測試 src/instrumentation.ts 的啟動檢查。
 *
 * register() 每次呼叫都重讀 process.env，所以靜態 import 即可；
 * 每個 case 備份還原 process.env。
 */
import { register } from './instrumentation';

describe('instrumentation register', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, NEXT_RUNTIME: 'nodejs' };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('未設 TRUST_PROXY 時發出警告', async () => {
    delete process.env.TRUST_PROXY;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await register();
    expect(
      warn.mock.calls.some((args) => String(args[0]).includes('TRUST_PROXY'))
    ).toBe(true);
    warn.mockRestore();
  });

  test('有設 TRUST_PROXY=true 時不警告', async () => {
    process.env.TRUST_PROXY = 'true';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await register();
    expect(
      warn.mock.calls.some((args) => String(args[0]).includes('TRUST_PROXY'))
    ).toBe(false);
    warn.mockRestore();
  });

  test('STORAGE_TYPE 與 NEXT_PUBLIC_STORAGE_TYPE 不一致時警告', async () => {
    process.env.TRUST_PROXY = 'true';
    process.env.STORAGE_TYPE = 'redis';
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'kvrocks';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await register();
    expect(
      warn.mock.calls.some((args) => String(args[0]).includes('STORAGE_TYPE'))
    ).toBe(true);
    warn.mockRestore();
  });

  test('兩者一致或只設一個時不警告 STORAGE_TYPE', async () => {
    process.env.TRUST_PROXY = 'true';
    process.env.STORAGE_TYPE = 'redis';
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await register();
    expect(
      warn.mock.calls.some((args) => String(args[0]).includes('STORAGE_TYPE'))
    ).toBe(false);
    warn.mockRestore();
  });
});
