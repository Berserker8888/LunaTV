export type SkipTemplate = {
  id: string;
  name: string;
  /** 片頭秒數，從 0 起算。 */
  introSeconds: number;
  /** 片尾秒數，正數表示最後幾秒。套用到播放器時會改成負數。 */
  outroSeconds: number;
};

export const SKIP_TEMPLATE_STORAGE_KEY = 'lunatv_skip_templates';
const MAX_TEMPLATES = 20;
const MAX_SECONDS = 3600;
const MAX_NAME_LENGTH = 24;

export type SkipTemplateConfig = {
  enable: true;
  intro_time: number;
  outro_time: number;
};

export function skipTemplateToConfig(
  template: SkipTemplate
): SkipTemplateConfig {
  return {
    enable: true,
    intro_time: template.introSeconds,
    outro_time: template.outroSeconds > 0 ? -template.outroSeconds : 0,
  };
}

export function escapeSkipTemplateLabel(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isWholeSeconds(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_SECONDS;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  for (const char of name) {
    if (char.charCodeAt(0) <= 31) return null;
  }
  return name;
}

function readSeconds(
  record: Record<string, unknown>,
  positiveKey: string,
  signedKey: string
): number | null {
  if (positiveKey in record) {
    const value = Number(record[positiveKey]);
    return isWholeSeconds(value) ? value : null;
  }
  if (signedKey in record) {
    const value = Number(record[signedKey]);
    if (!Number.isInteger(value) || Math.abs(value) > MAX_SECONDS) return null;
    return Math.abs(value);
  }
  return 0;
}

export function parseSkipTemplateImport(
  text: string
): { ok: true; templates: SkipTemplate[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 格式不正確' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: '範本必須是陣列' };
  }
  if (parsed.length > MAX_TEMPLATES) {
    return { ok: false, error: `最多 ${MAX_TEMPLATES} 個範本` };
  }

  const templates: SkipTemplate[] = [];
  const names = new Set<string>();
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `第 ${index + 1} 筆格式不對，未匯入` };
    }
    const record = item as Record<string, unknown>;
    const name = cleanName(record.name);
    const introSeconds = readSeconds(record, 'introSeconds', 'intro_time');
    const outroSeconds = readSeconds(record, 'outroSeconds', 'outro_time');
    if (!name || introSeconds === null || outroSeconds === null) {
      return { ok: false, error: `第 ${index + 1} 筆格式不對，未匯入` };
    }
    if (names.has(name)) {
      return { ok: false, error: `範本名稱重複：${name}` };
    }
    names.add(name);
    const rawId = typeof record.id === 'string' ? record.id.trim() : '';
    templates.push({
      id: rawId.slice(0, 40) || `tpl-${index + 1}`,
      name,
      introSeconds,
      outroSeconds,
    });
  }

  if (templates.length === 0) {
    return { ok: false, error: '沒有可匯入的範本' };
  }
  return { ok: true, templates };
}

export function serializeSkipTemplates(templates: SkipTemplate[]): string {
  return JSON.stringify(
    templates.map(({ name, introSeconds, outroSeconds }) => ({
      name,
      introSeconds,
      outroSeconds,
    })),
    null,
    2
  );
}

export function readSkipTemplates(): SkipTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SKIP_TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = parseSkipTemplateImport(raw);
    return parsed.ok ? parsed.templates : [];
  } catch {
    return [];
  }
}

export function writeSkipTemplates(templates: SkipTemplate[]): void {
  window.localStorage.setItem(
    SKIP_TEMPLATE_STORAGE_KEY,
    serializeSkipTemplates(templates)
  );
}

export function mergeSkipTemplates(
  current: SkipTemplate[],
  incoming: SkipTemplate[],
  mode: 'replace' | 'append'
): SkipTemplate[] {
  const base = mode === 'replace' ? [] : current;
  const names = new Set(base.map((item) => item.name));
  const merged = [...base];
  for (const item of incoming) {
    if (names.has(item.name) || merged.length >= MAX_TEMPLATES) continue;
    names.add(item.name);
    merged.push({
      ...item,
      id: `tpl-${merged.length + 1}`,
    });
  }
  return merged;
}
