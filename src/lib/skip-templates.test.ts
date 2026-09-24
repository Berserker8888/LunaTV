import {
  mergeSkipTemplates,
  parseSkipTemplateImport,
  serializeSkipTemplates,
  skipTemplateToConfig,
} from './skip-templates';

describe('skip templates', () => {
  it('imports positive seconds and signed player times', () => {
    const parsed = parseSkipTemplateImport(
      JSON.stringify([
        { name: '日劇', introSeconds: 90, outroSeconds: 80 },
        { name: '舊格式', intro_time: 60, outro_time: -30 },
      ])
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.templates.map((item) => item.outroSeconds)).toEqual([80, 30]);
    expect(skipTemplateToConfig(parsed.templates[0])).toEqual({
      enable: true,
      intro_time: 90,
      outro_time: -80,
    });
  });

  it('rejects a payload that is not a template list', () => {
    expect(parseSkipTemplateImport('{"name":"日劇"}').ok).toBe(false);
  });

  it('refuses the whole import when any row is invalid', () => {
    const parsed = parseSkipTemplateImport(
      JSON.stringify([
        { name: '日劇', introSeconds: 90, outroSeconds: 80 },
        { name: '', introSeconds: 1, outroSeconds: 1 },
      ])
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('未匯入');
  });

  it('appends without duplicating names and round-trips export', () => {
    const first = parseSkipTemplateImport(
      '[{"name":"日劇","introSeconds":90,"outroSeconds":90}]'
    );
    const extra = parseSkipTemplateImport(
      '[{"name":"日劇","introSeconds":1,"outroSeconds":1},{"name":"美劇","introSeconds":45,"outroSeconds":30}]'
    );
    if (!first.ok || !extra.ok) throw new Error('fixture');
    const merged = mergeSkipTemplates(
      first.templates,
      extra.templates,
      'append'
    );
    expect(merged.map((item) => item.name)).toEqual(['日劇', '美劇']);
    const exported = serializeSkipTemplates(merged);
    const again = parseSkipTemplateImport(exported);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.templates[1]?.introSeconds).toBe(45);
  });
});
