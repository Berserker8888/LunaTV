import { EmbyConfig } from './admin.types';
import type { ApiSite } from './config';
import {
  clearEmbyAuthCache,
  getDetailFromEmby,
  getEmbyAuth,
  getEmbyAuthHeader,
  searchFromEmby,
  testEmbyConnection,
} from './emby';

// Mock fetch globally for testing Emby API
const originalFetch = global.fetch;

function createMockResponse(
  data: unknown,
  init?: { ok?: boolean; status?: number; statusText?: string }
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

describe('Emby 模組測試 (src/lib/emby.ts)', () => {
  beforeEach(() => {
    clearEmbyAuthCache();
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('getEmbyAuthHeader', () => {
    it('應產生正確的 Emby Client 授權頭', () => {
      const header = getEmbyAuthHeader();
      expect(header).toContain('MediaBrowser Client="LunaTV"');
      expect(header).toContain('Device="Web"');
      expect(header).toContain('Version="3.7.4"');
      expect(header).not.toContain('Token=');
    });

    it('有提供 token 時應附帶 Token 欄位', () => {
      const header = getEmbyAuthHeader('test-token-123');
      expect(header).toContain('Token="test-token-123"');
    });
  });

  describe('getEmbyAuth', () => {
    const config: EmbyConfig = {
      enabled: true,
      serverUrl: 'https://emby.test.local:8096',
      username: 'alice',
      password: 'password123',
    };

    it('成功時應呼叫 AuthenticateByName 並回傳 Token 與 UserID', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        createMockResponse({
          AccessToken: 'fake-token-abc',
          User: { Id: 'user-id-999' },
        })
      );

      const auth = await getEmbyAuth(config);
      expect(auth).toEqual({
        token: 'fake-token-abc',
        userId: 'user-id-999',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://emby.test.local:8096/Users/AuthenticateByName',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // 第二次呼叫應命中快取，不應重複發起請求
      const cachedAuth = await getEmbyAuth(config);
      expect(cachedAuth).toEqual(auth);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('若使用者已有 apiKey 與 userId 應直接使用不打登入 API', async () => {
      global.fetch = jest.fn();
      const apiKeyConfig: EmbyConfig = {
        enabled: true,
        serverUrl: 'https://emby.test.local',
        username: 'alice',
        apiKey: 'direct-api-key',
        userId: 'direct-user-id',
      };
      const auth = await getEmbyAuth(apiKeyConfig);
      expect(auth).toEqual({
        token: 'direct-api-key',
        userId: 'direct-user-id',
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('認證失敗時應拋出詳細錯誤', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        createMockResponse('Invalid username or password', {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        })
      );

      await expect(getEmbyAuth(config)).rejects.toThrow('Emby 認證失敗');
    });
  });

  describe('testEmbyConnection', () => {
    it('連線成功時應回傳伺服器名稱與版本', async () => {
      global.fetch = jest
        .fn()
        // 第一次呼叫 Public Info
        .mockResolvedValueOnce(
          createMockResponse({
            ServerName: 'MyEmbyServer',
            Version: '4.8.0.0',
          })
        )
        // 第二次呼叫 AuthenticateByName
        .mockResolvedValueOnce(
          createMockResponse({
            AccessToken: 'test-tok',
            User: { Id: 'u1' },
          })
        );

      const res = await testEmbyConnection({
        serverUrl: 'https://emby.test.local',
        username: 'alice',
        password: 'pwd',
      });

      expect(res.success).toBe(true);
      expect(res.serverName).toBe('MyEmbyServer');
      expect(res.version).toBe('4.8.0.0');
    });

    it('伺服器網址為空時應直接失敗', async () => {
      const res = await testEmbyConnection({ serverUrl: '' });
      expect(res.success).toBe(false);
      expect(res.message).toContain('請輸入伺服器網址');
    });
  });

  describe('searchFromEmby 與 getDetailFromEmby', () => {
    const mockEmbyConfig: EmbyConfig = {
      enabled: true,
      serverUrl: 'https://emby.test.local',
      username: 'alice',
      password: 'pwd',
      name: 'Emby 公費服',
      tag: '4K原畫',
    };

    const mockApiSite: ApiSite = {
      key: 'emby',
      name: 'Emby 公費服',
      api: 'https://emby.test.local',
      tag: '4K原畫',
      type: 'emby',
    };

    beforeEach(() => {
      // no-op
    });

    it('searchFromEmby: 正確搜尋電影與影集並轉為 SearchResult', async () => {
      global.fetch = jest
        .fn()
        // 登入
        .mockResolvedValueOnce(
          createMockResponse({
            AccessToken: 'token-123',
            User: { Id: 'user-456' },
          })
        )
        // 搜尋
        .mockResolvedValueOnce(
          createMockResponse({
            Items: [
              {
                Id: '1001',
                Name: '奧本海默',
                Type: 'Movie',
                ProductionYear: 2023,
                Overview: '原子彈之父的傳記電影。',
              },
              {
                Id: '1002',
                Name: '間諜家家酒',
                Type: 'Series',
                ProductionYear: 2022,
                Overview: '間諜與讀心術少女的喜劇。',
                ChildCount: 25,
              },
            ],
          })
        );

      const results = await searchFromEmby(
        mockApiSite,
        '奧本海默',
        undefined,
        mockEmbyConfig
      );
      expect(results).toHaveLength(2);

      // 電影檢查
      expect(results[0].title).toBe('奧本海默');
      expect(results[0].type_name).toBe('電影');
      expect(results[0].source).toBe('emby');
      expect(results[0].source_name).toBe('Emby 公費服');
      expect(results[0].source_tag).toBe('4K原畫');
      expect(results[0].episodes).toHaveLength(1);
      expect(results[0].episodes[0]).toContain(
        'https://emby.test.local/Videos/1001/stream?static=true&api_key=token-123'
      );

      // 影集檢查
      expect(results[1].title).toBe('間諜家家酒');
      expect(results[1].type_name).toBe('影集');
      expect(results[1].episode_count).toBe(25);
    });

    it('getDetailFromEmby: 電影回傳單集串流網址', async () => {
      global.fetch = jest
        .fn()
        // 登入
        .mockResolvedValueOnce(
          createMockResponse({
            AccessToken: 'token-123',
            User: { Id: 'user-456' },
          })
        )
        // 取得項目
        .mockResolvedValueOnce(
          createMockResponse({
            Id: '1001',
            Name: '奧本海默',
            Type: 'Movie',
            ProductionYear: 2023,
            Overview: '電影簡介',
          })
        );

      const detail = await getDetailFromEmby(
        mockApiSite,
        '1001',
        mockEmbyConfig
      );
      expect(detail.title).toBe('奧本海默');
      expect(detail.episodes).toHaveLength(1);
      expect(detail.episodes_titles).toEqual(['正片']);
      expect(detail.episodes[0]).toContain('/Videos/1001/stream');
    });

    it('getDetailFromEmby: 影集應抓取所有分集並按季數/集數排序', async () => {
      global.fetch = jest
        .fn()
        // 登入
        .mockResolvedValueOnce(
          createMockResponse({
            AccessToken: 'token-123',
            User: { Id: 'user-456' },
          })
        )
        // 取得影集項目資訊
        .mockResolvedValueOnce(
          createMockResponse({
            Id: '1002',
            Name: '間諜家家酒',
            Type: 'Series',
            ProductionYear: 2022,
            Overview: '影集簡介',
          })
        )
        // 取得分集列表
        .mockResolvedValueOnce(
          createMockResponse({
            Items: [
              {
                Id: 'ep2',
                Name: '第二集',
                IndexNumber: 2,
                ParentIndexNumber: 1,
              },
              {
                Id: 'ep1',
                Name: '第一集',
                IndexNumber: 1,
                ParentIndexNumber: 1,
              },
              {
                Id: 'ep3',
                Name: '新任務',
                IndexNumber: 1,
                ParentIndexNumber: 2,
              },
            ],
          })
        );

      const detail = await getDetailFromEmby(
        mockApiSite,
        '1002',
        mockEmbyConfig
      );
      expect(detail.title).toBe('間諜家家酒');
      expect(detail.episodes).toHaveLength(3);

      // 檢查排序是否正確（S1E1, S1E2, S2E1）
      expect(detail.episodes[0]).toContain('/Videos/ep1/stream');
      expect(detail.episodes[1]).toContain('/Videos/ep2/stream');
      expect(detail.episodes[2]).toContain('/Videos/ep3/stream');

      expect(detail.episodes_titles[0]).toBe('第 1 集 第一集');
      expect(detail.episodes_titles[1]).toBe('第 2 集 第二集');
      expect(detail.episodes_titles[2]).toBe('S2 第 1 集 新任務');
    });

    it('getDetailFromEmby: 空影集或尚未發行的影集應安全回傳空集數而不崩潰', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(
          createMockResponse({
            AccessToken: 'token-123',
            User: { Id: 'user-456' },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            Id: '13840',
            Name: '鐵拳教育',
            Type: 'Series',
            ProductionYear: 2026,
            Overview: '即將上映',
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            Items: [],
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            Items: [],
          })
        );

      const detail = await getDetailFromEmby(
        mockApiSite,
        '13840',
        mockEmbyConfig
      );
      expect(detail.title).toBe('鐵拳教育');
      expect(detail.episodes).toHaveLength(0);
      expect(detail.episode_count).toBe(0);
      expect(detail.type_name).toBe('影集');
    });
  });
});
