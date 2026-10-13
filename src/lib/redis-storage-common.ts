/* eslint-disable @typescript-eslint/no-explicit-any */

export const SEARCH_HISTORY_LIMIT = 20;
export const LOCK_RELEASE_RECEIPT_TTL_MS = 60_000;

export const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

export const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2])
  return 1
end
if redis.call('GET', KEYS[2]) == ARGV[1] then
  return 1
end
return 0
`;

export function ensureString(value: any): string {
  return String(value);
}

export function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 統一的 Redis / Upstash Key 命名常數與生成函式
export function prHashKey(user: string): string {
  return `u:${user}:pr`;
}

export function favHashKey(user: string): string {
  return `u:${user}:fav`;
}

export function userPwdKey(user: string): string {
  return `u:${user}:pwd`;
}

export function usersSetKey(): string {
  return 'sys:users';
}

export function searchHistoryKey(username: string): string {
  return `u:${username}:sh`;
}

export function adminConfigKey(): string {
  return 'admin:config';
}

export function skipHashKey(user: string): string {
  return `u:${user}:skip`;
}

export function skipField(source: string, id: string): string {
  return `${source}+${id}`;
}

export function migrationKey(): string {
  return 'sys:migration:hash_v2';
}

export function pwdMigrationKey(): string {
  return 'sys:migration:pwd_hash_v1';
}

export function bangumiAliasHashKey(): string {
  return 'sys:bangumi_aliases';
}
