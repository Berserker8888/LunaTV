import { EmbyConfig } from './admin.types';
import type { ApiSite } from './config';
import { getConfig } from './config';
import { logger } from './logger';
import type { SearchResult } from './types';

const EMBY_CLIENT_NAME = 'LunaTV';
const EMBY_DEVICE_NAME = 'Web';
const EMBY_DEVICE_ID = 'lunatv-web-client';
const EMBY_CLIENT_VERSION = '3.7.4';
const AUTH_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 小時
const EMBY_REQUEST_TIMEOUT_MS = 10_000;

interface CachedAuth {
  token: string;
  userId: string;
  expiresAt: number;
}

const authCache = new Map<string, CachedAuth>();

export function clearEmbyAuthCache(): void {
  authCache.clear();
}

export function getEmbyAuthHeader(token?: string): string {
  const parts = [
    `MediaBrowser Client="${EMBY_CLIENT_NAME}"`,
    `Device="${EMBY_DEVICE_NAME}"`,
    `DeviceId="${EMBY_DEVICE_ID}"`,
    `Version="${EMBY_CLIENT_VERSION}"`,
  ];
  if (token) {
    parts.push(`Token="${token}"`);
  }
  return parts.join(', ');
}

function cleanBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 取得 Emby 認證 Token 與 User ID
 */
export async function getEmbyAuth(
  config: EmbyConfig
): Promise<{ token: string; userId: string }> {
  const serverUrl = cleanBaseUrl(config.serverUrl);
  if (!serverUrl) {
    throw new Error('未設定 Emby 伺服器網址');
  }

  // 若使用者已直接提供 apiKey 與 userId，直接使用
  if (config.apiKey) {
    if (config.userId) {
      return { token: config.apiKey, userId: config.userId };
    }
    // 若有 apiKey 但未填 userId，自動嘗試查詢可用使用者 ID
    try {
      const usersRes = await fetch(
        `${serverUrl}/Users?api_key=${encodeURIComponent(config.apiKey)}`,
        { headers: { Accept: 'application/json' } }
      );
      if (usersRes.ok) {
        const users = await usersRes.json();
        if (Array.isArray(users) && users.length > 0 && users[0].Id) {
          return { token: config.apiKey, userId: String(users[0].Id) };
        }
      }
    } catch (err) {
      logger.warn('自動查詢 Emby User ID 失敗:', err);
    }
  }

  const cacheKey = `${serverUrl}:${config.username || ''}`;
  const cached = authCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { token: cached.token, userId: cached.userId };
  }

  // 使用帳號密碼登入換取 Token
  if (!config.username) {
    throw new Error('未設定 Emby 帳號');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBY_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'X-Emby-Authorization': getEmbyAuthHeader(),
      },
      body: JSON.stringify({
        Username: config.username,
        Pw: config.password || '',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(
        `Emby 認證失敗 (${res.status}): ${errText || res.statusText}`
      );
    }

    const data = await res.json();
    const token = data.AccessToken;
    const userId = data.User?.Id;

    if (!token || !userId) {
      throw new Error('Emby 登入回應未包含 Token 或 User ID');
    }

    authCache.set(cacheKey, {
      token,
      userId,
      expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    });

    return { token, userId };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 測試 Emby 連線與認證狀態
 */
export async function testEmbyConnection(config: Partial<EmbyConfig>): Promise<{
  success: boolean;
  message: string;
  serverName?: string;
  version?: string;
}> {
  try {
    const serverUrl = cleanBaseUrl(config.serverUrl || '');
    if (!serverUrl) {
      return { success: false, message: '請輸入伺服器網址' };
    }

    // 先測試公開資訊端點
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let serverName = '';
    let version = '';

    try {
      const infoRes = await fetch(`${serverUrl}/System/Info/Public`, {
        headers: {
          Accept: 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(),
        },
        signal: controller.signal,
      });
      if (infoRes.ok) {
        const info = await infoRes.json();
        serverName = info.ServerName || '';
        version = info.Version || '';
      }
    } catch {
      // 某些伺服器關閉公共資訊端點，繼續嘗試認證
    } finally {
      clearTimeout(timer);
    }

    // 進行帳號驗證
    if (config.username) {
      const fullConfig: EmbyConfig = {
        enabled: true,
        serverUrl,
        username: config.username,
        password: config.password || '',
        apiKey: config.apiKey,
        userId: config.userId,
      };
      const auth = await getEmbyAuth(fullConfig);
      if (auth.token && auth.userId) {
        return {
          success: true,
          message: '連線與認證成功',
          serverName: serverName || 'Emby Server',
          version,
        };
      }
    }

    return {
      success: true,
      message: '伺服器可連通',
      serverName: serverName || 'Emby Server',
      version,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : '連線失敗',
    };
  }
}

function getEmbyPosterUrl(
  serverUrl: string,
  itemId: string | number,
  token: string
): string {
  const cleanServer = cleanBaseUrl(serverUrl);
  const rawUrl = `${cleanServer}/Items/${String(itemId)}/Images/Primary?maxHeight=400&api_key=${encodeURIComponent(token)}`;
  return `/api/image-proxy?url=${encodeURIComponent(rawUrl)}`;
}

function getEmbyStreamUrl(
  serverUrl: string,
  itemId: string | number,
  token: string
): string {
  const cleanServer = cleanBaseUrl(serverUrl);
  return `${cleanServer}/Videos/${String(itemId)}/stream?static=true&api_key=${encodeURIComponent(token)}`;
}

/**
 * 從 Emby 搜尋影視資源
 */
export async function searchFromEmby(
  apiSite: ApiSite,
  query: string,
  signal?: AbortSignal,
  embyConfigOverride?: EmbyConfig
): Promise<SearchResult[]> {
  try {
    const adminConfig = embyConfigOverride
      ? { EmbyConfig: embyConfigOverride }
      : await getConfig();
    const embyConfig = adminConfig.EmbyConfig;
    if (!embyConfig || !embyConfig.enabled || !embyConfig.serverUrl) {
      return [];
    }

    const { token, userId } = await getEmbyAuth(embyConfig);
    const serverUrl = cleanBaseUrl(embyConfig.serverUrl);

    const params = new URLSearchParams({
      searchTerm: query,
      IncludeItemTypes: 'Movie,Series,Episode',
      Recursive: 'true',
      Fields:
        'Overview,ProductionYear,PrimaryImageAspectRatio,Path,Genres,ChildCount,RecursiveItemCount',
      Limit: '30',
    });

    const url = `${serverUrl}/Users/${userId}/Items?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Emby-Token': token,
        'X-Emby-Authorization': getEmbyAuthHeader(token),
      },
      signal,
    });

    if (res.status === 401) {
      // Token 過期重試一次
      const cacheKey = `${serverUrl}:${embyConfig.username || ''}`;
      authCache.delete(cacheKey);
      const freshAuth = await getEmbyAuth(embyConfig);
      const retryRes = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Emby-Token': freshAuth.token,
          'X-Emby-Authorization': getEmbyAuthHeader(freshAuth.token),
        },
        signal,
      });
      if (!retryRes.ok) return [];
      const data = await retryRes.json();
      return mapEmbyItemsToSearchResults(
        data.Items || [],
        serverUrl,
        freshAuth.token,
        apiSite,
        embyConfig
      );
    }

    if (!res.ok) {
      logger.warn(`Emby 搜尋失敗: HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return mapEmbyItemsToSearchResults(
      data.Items || [],
      serverUrl,
      token,
      apiSite,
      embyConfig
    );
  } catch (error) {
    if (signal?.aborted) return [];
    logger.warn('Emby 搜尋發生錯誤:', error);
    return [];
  }
}

interface EmbyItem {
  Id: string | number;
  Name?: string;
  Type?: string;
  ProductionYear?: number;
  Overview?: string;
  ChildCount?: number;
  RecursiveItemCount?: number;
}

function mapEmbyItemsToSearchResults(
  items: EmbyItem[],
  serverUrl: string,
  token: string,
  apiSite: ApiSite,
  config: EmbyConfig
): SearchResult[] {
  return items.map((item) => {
    const isMovie =
      item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video';
    const streamUrl = getEmbyStreamUrl(serverUrl, item.Id, token);
    const poster = getEmbyPosterUrl(serverUrl, item.Id, token);
    const count = item.RecursiveItemCount || item.ChildCount;
    const episodeCount = isMovie
      ? 1
      : typeof count === 'number' && count > 0
        ? count
        : 0;

    return {
      id: String(item.Id),
      title: item.Name || '',
      poster,
      episodes: isMovie ? [streamUrl] : [],
      episodes_titles: isMovie ? ['正片'] : [],
      episode_count: episodeCount,
      source: apiSite.key || 'emby',
      source_name: apiSite.name || config.name || 'Emby 影庫',
      source_tag: apiSite.tag || config.tag || '4K原畫',
      year: item.ProductionYear ? String(item.ProductionYear) : 'unknown',
      desc: item.Overview || '',
      type_name: isMovie ? '電影' : '影集',
    };
  });
}

interface EmbyEpisodeItem {
  Id: string | number;
  Name?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
}

/**
 * 取得 Emby 影片/影集詳情與可播集數
 */
export async function getDetailFromEmby(
  apiSite: ApiSite,
  id: string,
  embyConfigOverride?: EmbyConfig
): Promise<SearchResult> {
  const adminConfig = embyConfigOverride
    ? { EmbyConfig: embyConfigOverride }
    : await getConfig();
  const embyConfig = adminConfig.EmbyConfig;
  if (!embyConfig || !embyConfig.enabled || !embyConfig.serverUrl) {
    throw new Error('Emby 來源未啟用或設定不完整');
  }

  const { token, userId } = await getEmbyAuth(embyConfig);
  const serverUrl = cleanBaseUrl(embyConfig.serverUrl);

  const itemUrl = `${serverUrl}/Users/${userId}/Items/${id}?Fields=Overview,ProductionYear,Path,Genres`;
  let item: EmbyItem | null = null;
  try {
    const res = await fetch(itemUrl, {
      headers: {
        Accept: 'application/json',
        'X-Emby-Token': token,
        'X-Emby-Authorization': getEmbyAuthHeader(token),
      },
    });

    if (res.ok) {
      item = await res.json();
    }
  } catch (err) {
    logger.warn(`取得 Emby 項目 ${id} 失敗:`, err);
  }

  if (!item) {
    // 找不到該 ID 時回傳空結果，讓播放端自動切換其他來源
    return {
      id,
      title: '',
      poster: '',
      episodes: [],
      episodes_titles: [],
      episode_count: 0,
      source: apiSite.key || 'emby',
      source_name: apiSite.name || embyConfig.name || 'Emby 影庫',
      source_tag: apiSite.tag || embyConfig.tag || '4K原畫',
      year: 'unknown',
      desc: '',
      type_name: '電影',
    };
  }

  const poster = getEmbyPosterUrl(serverUrl, item.Id, token);
  const isSeries = item.Type === 'Series';

  // 非影集（電影、單集短片、獨立影片等）直接產生串流網址
  if (!isSeries) {
    const streamUrl = getEmbyStreamUrl(serverUrl, item.Id, token);
    return {
      id: String(item.Id),
      title: item.Name || '',
      poster,
      episodes: [streamUrl],
      episodes_titles: ['正片'],
      episode_count: 1,
      source: apiSite.key || 'emby',
      source_name: apiSite.name || embyConfig.name || 'Emby 影庫',
      source_tag: apiSite.tag || embyConfig.tag || '4K原畫',
      year: item.ProductionYear ? String(item.ProductionYear) : 'unknown',
      desc: item.Overview || '',
      type_name: '電影',
    };
  }

  // 影集：取得所有分集
  let rawEpisodes: EmbyEpisodeItem[] = [];

  // 1. 優先嘗試標準 Shows/{id}/Episodes 端點
  try {
    const episodesUrl = `${serverUrl}/Shows/${id}/Episodes?UserId=${encodeURIComponent(userId)}&Fields=Overview,Path`;
    const epRes = await fetch(episodesUrl, {
      headers: {
        Accept: 'application/json',
        'X-Emby-Token': token,
        'X-Emby-Authorization': getEmbyAuthHeader(token),
      },
    });

    if (epRes.ok) {
      const epData = await epRes.json();
      if (Array.isArray(epData.Items) && epData.Items.length > 0) {
        rawEpisodes = epData.Items;
      }
    }
  } catch (err) {
    logger.warn(`Emby /Shows/${id}/Episodes 查詢失敗:`, err);
  }

  // 2. 若 Shows/{id}/Episodes 無分集或失敗，退回通用 Items 端點（支援多季或目錄嵌套）
  if (rawEpisodes.length === 0) {
    try {
      const itemsUrl = `${serverUrl}/Users/${userId}/Items?ParentId=${id}&IncludeItemTypes=Episode&Recursive=true&Fields=Overview,Path`;
      const itemsRes = await fetch(itemsUrl, {
        headers: {
          Accept: 'application/json',
          'X-Emby-Token': token,
          'X-Emby-Authorization': getEmbyAuthHeader(token),
        },
      });

      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        if (Array.isArray(itemsData.Items) && itemsData.Items.length > 0) {
          rawEpisodes = itemsData.Items;
        }
      }
    } catch (err) {
      logger.warn(`Emby 通用 Items 查詢分集失敗:`, err);
    }
  }

  // 按季數與集數排序
  const sortedEpisodes = [...rawEpisodes].sort((a, b) => {
    const sA = a.ParentIndexNumber ?? 1;
    const sB = b.ParentIndexNumber ?? 1;
    if (sA !== sB) return sA - sB;
    return (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0);
  });

  const episodes: string[] = [];
  const episodes_titles: string[] = [];

  for (const ep of sortedEpisodes) {
    episodes.push(getEmbyStreamUrl(serverUrl, ep.Id, token));

    let title = '';
    const seasonStr =
      ep.ParentIndexNumber && ep.ParentIndexNumber > 1
        ? `S${ep.ParentIndexNumber} `
        : '';
    const epNum =
      ep.IndexNumber !== undefined ? `第 ${ep.IndexNumber} 集` : ep.Name || '';
    const epName =
      ep.Name &&
      ep.Name !== `Episode ${ep.IndexNumber}` &&
      ep.Name !== `第${ep.IndexNumber}集` &&
      ep.Name !== `第 ${ep.IndexNumber} 集`
        ? ` ${ep.Name}`
        : '';

    title = `${seasonStr}${epNum}${epName}`.trim() || '正片';
    episodes_titles.push(title);
  }

  return {
    id: String(item.Id),
    title: item.Name || '',
    poster,
    episodes,
    episodes_titles,
    episode_count: episodes.length,
    source: apiSite.key || 'emby',
    source_name: apiSite.name || embyConfig.name || 'Emby 影庫',
    source_tag: apiSite.tag || embyConfig.tag || '4K原畫',
    year: item.ProductionYear ? String(item.ProductionYear) : 'unknown',
    desc: item.Overview || '',
    type_name: '影集',
  };
}
