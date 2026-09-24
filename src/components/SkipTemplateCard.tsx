'use client';

import { useState } from 'react';

import {
  mergeSkipTemplates,
  parseSkipTemplateImport,
  readSkipTemplates,
  serializeSkipTemplates,
  type SkipTemplate,
  writeSkipTemplates,
} from '@/lib/skip-templates';

export function SkipTemplateCard() {
  const [templates, setTemplates] = useState<SkipTemplate[]>(() =>
    readSkipTemplates()
  );
  const [name, setName] = useState('');
  const [introSeconds, setIntroSeconds] = useState('90');
  const [outroSeconds, setOutroSeconds] = useState('90');
  const [importText, setImportText] = useState('');
  const [message, setMessage] = useState('');

  const persist = (next: SkipTemplate[], notice: string) => {
    setTemplates(next);
    writeSkipTemplates(next);
    setMessage(notice);
  };

  const addTemplate = () => {
    const parsed = parseSkipTemplateImport(
      JSON.stringify([
        {
          name,
          introSeconds: Number(introSeconds),
          outroSeconds: Number(outroSeconds),
        },
      ])
    );
    if (!parsed.ok) {
      setMessage(parsed.error);
      return;
    }
    if (templates.some((item) => item.name === parsed.templates[0]?.name)) {
      setMessage('已有同名範本');
      return;
    }
    const next = mergeSkipTemplates(templates, parsed.templates, 'append');
    if (next.length === templates.length) {
      setMessage('範本數量已達上限');
      return;
    }
    persist(next, '已新增範本');
    setName('');
  };

  const importTemplates = (mode: 'replace' | 'append') => {
    const parsed = parseSkipTemplateImport(importText);
    if (!parsed.ok) {
      setMessage(parsed.error);
      return;
    }
    const next = mergeSkipTemplates(templates, parsed.templates, mode);
    persist(
      next,
      mode === 'replace' ? '已以匯入內容取代範本' : '已加入匯入的範本'
    );
    setImportText('');
  };

  const exportTemplates = async () => {
    const text = serializeSkipTemplates(templates);
    try {
      await navigator.clipboard.writeText(text);
      setMessage('已複製範本 JSON');
    } catch {
      setImportText(text);
      setMessage('無法複製，JSON 已放到下方輸入框');
    }
  };

  return (
    <div className='bg-white dark:bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-200 dark:border-white/5 p-6'>
      <h2 className='font-bold text-base'>片頭片尾範本</h2>
      <p className='text-xs text-zinc-500 mt-1 leading-relaxed'>
        存在這台瀏覽器。重新開啟播放頁後，播放器設定裡可以一鍵套用。
      </p>

      <div className='mt-4 grid grid-cols-1 sm:grid-cols-[1fr_6rem_6rem_auto] gap-2'>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder='範本名稱，例如日劇'
          aria-label='範本名稱'
          className='rounded-xl border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-sm bg-white dark:bg-black/40'
        />
        <input
          value={introSeconds}
          onChange={(event) => setIntroSeconds(event.target.value)}
          inputMode='numeric'
          aria-label='片頭秒數'
          className='rounded-xl border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-sm bg-white dark:bg-black/40'
        />
        <input
          value={outroSeconds}
          onChange={(event) => setOutroSeconds(event.target.value)}
          inputMode='numeric'
          aria-label='片尾秒數'
          className='rounded-xl border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-sm bg-white dark:bg-black/40'
        />
        <button
          type='button'
          onClick={addTemplate}
          className='rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white'
        >
          新增
        </button>
      </div>
      <p className='mt-1 text-[11px] text-zinc-500'>
        中間是片頭秒數，右邊是片尾秒數。
      </p>

      {templates.length > 0 && (
        <ul className='mt-4 space-y-2'>
          {templates.map((template) => (
            <li
              key={template.id}
              className='flex items-center justify-between gap-3 rounded-xl bg-zinc-100 dark:bg-zinc-800/40 px-3 py-2 text-sm'
            >
              <span className='min-w-0 truncate'>
                {template.name}
                <span className='ml-2 text-xs text-zinc-500 tabular-nums'>
                  片頭 {template.introSeconds} 秒／片尾 {template.outroSeconds}{' '}
                  秒
                </span>
              </span>
              <button
                type='button'
                onClick={() =>
                  persist(
                    templates.filter((item) => item.id !== template.id),
                    '已刪除範本'
                  )
                }
                className='shrink-0 text-xs text-zinc-500 hover:text-red-400'
              >
                刪除
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className='mt-4 flex flex-wrap gap-2'>
        <button
          type='button'
          onClick={() => void exportTemplates()}
          disabled={templates.length === 0}
          className='rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm disabled:opacity-40'
        >
          複製 JSON
        </button>
      </div>

      <label className='mt-4 block text-xs text-zinc-500'>
        貼上 JSON 後匯入
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          rows={4}
          placeholder='[{"name":"日劇","introSeconds":90,"outroSeconds":90}]'
          className='mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-sm bg-white dark:bg-black/40'
        />
      </label>
      <div className='mt-2 flex flex-wrap gap-2'>
        <button
          type='button'
          onClick={() => importTemplates('append')}
          className='rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm'
        >
          追加匯入
        </button>
        <button
          type='button'
          onClick={() => importTemplates('replace')}
          className='rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm'
        >
          取代匯入
        </button>
      </div>
      {message && (
        <p className='mt-3 text-xs text-zinc-500' role='status'>
          {message}
        </p>
      )}
    </div>
  );
}
