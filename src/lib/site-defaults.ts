export const DEFAULT_SITE_NAME = 'LunaTV';

const LEGACY_DEFAULT_SITE_NAMES = new Set(['MoonTV', 'BerserkerTV']);

export function isLegacyDefaultSiteName(name: string): boolean {
  return LEGACY_DEFAULT_SITE_NAMES.has(name);
}
