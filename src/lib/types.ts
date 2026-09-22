import { AdminConfig } from './admin.types';

// 播放記錄資料結構
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第幾集
  total_episodes: number; // 總集數
  play_time: number; // 播放進度（秒）
  total_time: number; // 總時長（秒）
  save_time: number; // 記錄儲存時間（時間戳）
  search_title: string; // 搜尋時使用的標題
  /** 使用者上次看到的總集數。小於 total_episodes 時首頁顯示有新集。 */
  known_episodes?: number;
  vod_id?: string;
  source?: string;
}

// 收藏資料結構
export interface Favorite {
  source_name: string;
  total_episodes: number; // 總集數
  title: string;
  year: string;
  cover: string;
  save_time: number; // 記錄儲存時間（時間戳）
  search_title: string; // 搜尋時使用的標題
  origin?: 'vod' | 'live';
  /** 使用者上次看到的總集數。小於 total_episodes 時收藏顯示有新集。 */
  known_episodes?: number;
}

// 儲存介面
export interface IStorage {
  // 可選的跨實例互斥鎖；Redis 類儲存實作，localStorage/noop 不實作。
  acquireLock?(
    key: string,
    ownerToken: string,
    ttlMs: number
  ): Promise<boolean>;
  renewLock?(key: string, ownerToken: string, ttlMs: number): Promise<boolean>;
  releaseLock?(key: string, ownerToken: string): Promise<boolean>;

  // 播放記錄相關
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  deletePlayRecord(userName: string, key: string): Promise<void>;
  deleteAllPlayRecords(userName: string): Promise<void>;

  // 收藏相關
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  deleteFavorite(userName: string, key: string): Promise<void>;
  deleteAllFavorites(userName: string): Promise<void>;

  // 使用者相關
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 檢查使用者是否存在（無需密碼）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改使用者密碼
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 刪除使用者（包括密碼、搜尋歷史、播放記錄、收藏夾）
  deleteUser(userName: string): Promise<void>;

  // 搜尋歷史相關
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(userName: string, keyword: string): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 使用者列表
  getAllUsers(): Promise<string[]>;

  // 管理員設定相關
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;

  // 跳過片頭片尾設定相關
  getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null>;
  setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void>;
  deleteSkipConfig(userName: string, source: string, id: string): Promise<void>;
  getAllSkipConfigs(userName: string): Promise<{ [key: string]: SkipConfig }>;

  // 資料遷移（舊扁平 key → Hash 結構）
  migrateData?(): Promise<void>;

  // 密碼遷移（明文 → 加鹽雜湊）
  migratePasswords?(): Promise<void>;

  // 資料清理相關
  clearAllData(): Promise<void>;
}

// 搜尋結果資料結構
export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  episodes_titles: string[];
  /** 搜尋快取不存播放網址時仍保留集數，給卡片／換源列表顯示。 */
  episode_count?: number;
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
}

// 豆瓣資料結構
export interface DoubanItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
  original_title?: string;
}

export interface DoubanResult {
  code: number;
  message: string;
  list: DoubanItem[];
}

// 跳過片頭片尾設定資料結構
export interface SkipConfig {
  enable: boolean; // 是否啟用跳過片頭片尾
  intro_time: number; // 片頭時間（秒）
  outro_time: number; // 片尾時間（秒）
}
