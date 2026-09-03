'use client';

import { useState } from 'react';

import { TitleAlias } from '@/lib/admin.types';
import {
  MAX_TITLE_ALIASES,
  parseTitleAliasList,
} from '@/lib/regional-title-aliases';
import { readErrorMessage } from '@/lib/safe-json';

import {
  AlertModal,
  showError,
  showSuccess,
  useAlertModal,
} from './AlertModal';
import { buttonStyles } from './buttonStyles';
import { useLoadingState } from './Loading';

const JSON_EXAMPLE = `[
  { "tw": "台灣片名", "cn": "大陆片名" }
]`;

export function TitleAliasesCard({
  aliases,
  refreshConfig,
}: {
  aliases: TitleAlias[];
  refreshConfig: () => Promise<void>;
}) {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [tw, setTw] = useState('');
  const [cn, setCn] = useState('');
  const [importText, setImportText] = useState('');

  const handleAdd = () =>
    withLoading('addTitleAlias', async () => {
      try {
        const response = await fetch('/api/admin/title-aliases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tw, cn }),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '新增失敗'));
        }
        setTw('');
        setCn('');
        await refreshConfig();
        showSuccess('已儲存別名', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '新增失敗',
          showAlert
        );
      }
    });

  const handleDelete = (title: string) =>
    withLoading(`deleteTitleAlias-${title}`, async () => {
      try {
        const response = await fetch(
          `/api/admin/title-aliases?tw=${encodeURIComponent(title)}`,
          { method: 'DELETE' }
        );
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '刪除失敗'));
        }
        await refreshConfig();
        showSuccess('已刪除別名', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '刪除失敗',
          showAlert
        );
      }
    });

  const handleImport = (mode: 'merge' | 'replace') =>
    withLoading(`importTitleAlias-${mode}`, async () => {
      if (!importText.trim()) {
        showError('請貼上 JSON 陣列', showAlert);
        return;
      }

      let raw: unknown = null;
      try {
        raw = JSON.parse(importText);
      } catch {
        showError('JSON 格式不正確', showAlert);
        return;
      }

      const parsed = parseTitleAliasList(raw);
      if (parsed.aliases.length === 0) {
        showError(
          '沒有可匯入的別名。請貼上 [{ "tw": "台灣片名", "cn": "大陆片名" }]。',
          showAlert
        );
        return;
      }

      if (
        mode === 'replace' &&
        aliases.length > 0 &&
        typeof window !== 'undefined' &&
        !window.confirm(
          `將以 ${parsed.aliases.length} 筆覆蓋目前 ${aliases.length} 筆自訂別名？內建對照不受影響。`
        )
      ) {
        return;
      }

      try {
        const response = await fetch('/api/admin/title-aliases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aliases: parsed.aliases, mode }),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '匯入失敗'));
        }
        const result = (await response.json()) as {
          added?: number;
          updated?: number;
          skipped?: number;
          count?: number;
        };
        setImportText('');
        await refreshConfig();
        const skippedNote =
          (result.skipped || 0) + parsed.skipped > 0
            ? `（略過 ${(result.skipped || 0) + parsed.skipped} 筆無效或重複）`
            : '';
        showSuccess(
          mode === 'replace'
            ? `已覆蓋為 ${result.count ?? parsed.aliases.length} 筆自訂別名${skippedNote}`
            : `已追加 ${result.added ?? 0} 筆、更新 ${result.updated ?? 0} 筆${skippedNote}`,
          showAlert
        );
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '匯入失敗',
          showAlert
        );
      }
    });

  const importBusy =
    isLoading('importTitleAlias-merge') ||
    isLoading('importTitleAlias-replace');

  return (
    <div className='mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800'>
      <h3 className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
        台灣／陸源片名別名
      </h3>
      <p className='mt-1 text-xs leading-relaxed text-zinc-500'>
        魔戒、怕痛的我、天能、出神入化、屍速列車等常見台譯已內建，升級即可搜，不必在這裡重填。
        這裡只留給冷門片，或你要覆蓋內建譯名。最多 {MAX_TITLE_ALIASES}{' '}
        筆；台灣片名至少兩個字。
      </p>

      <div className='mt-4 flex flex-col gap-2 sm:flex-row'>
        <input
          type='text'
          value={tw}
          onChange={(event) => setTw(event.target.value)}
          placeholder='台灣搜尋片名'
          className='min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'
        />
        <input
          type='text'
          value={cn}
          onChange={(event) => setCn(event.target.value)}
          placeholder='大陸片源片名'
          className='min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'
        />
        <button
          type='button'
          onClick={() => void handleAdd()}
          disabled={isLoading('addTitleAlias')}
          className={`${
            isLoading('addTitleAlias')
              ? buttonStyles.disabled
              : buttonStyles.success
          } shrink-0`}
        >
          {isLoading('addTitleAlias') ? '新增中…' : '新增'}
        </button>
      </div>

      <details className='mt-4 rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/40'>
        <summary className='cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-300'>
          貼上 JSON 批次匯入
        </summary>
        <p className='mt-2 text-xs leading-relaxed text-zinc-500'>
          接受陣列或 <code className='font-mono'>{'{ "aliases": [...] }'}</code>
          。追加會依台灣片名覆蓋舊值；覆蓋只改自訂表，不動內建對照。
        </p>
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={JSON_EXAMPLE}
          rows={6}
          spellCheck={false}
          className='mt-2 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'
        />
        <div className='mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end'>
          <button
            type='button'
            onClick={() => void handleImport('merge')}
            disabled={importBusy}
            className={
              importBusy ? buttonStyles.disabled : buttonStyles.success
            }
          >
            {isLoading('importTitleAlias-merge') ? '匯入中…' : '追加匯入'}
          </button>
          <button
            type='button'
            onClick={() => void handleImport('replace')}
            disabled={importBusy}
            className={
              importBusy ? buttonStyles.disabled : buttonStyles.warning
            }
          >
            {isLoading('importTitleAlias-replace') ? '覆蓋中…' : '覆蓋自訂別名'}
          </button>
        </div>
      </details>

      {aliases.length === 0 ? (
        <p className='mt-3 text-xs text-zinc-500'>尚未自訂別名。</p>
      ) : (
        <ul className='mt-4 divide-y divide-zinc-200 dark:divide-zinc-800'>
          {aliases.map((alias) => (
            <li
              key={alias.tw}
              className='flex items-center justify-between gap-3 py-2 text-sm'
            >
              <span className='min-w-0 truncate text-zinc-800 dark:text-zinc-200'>
                {alias.tw}
                <span className='mx-2 text-zinc-400'>→</span>
                {alias.cn}
              </span>
              <button
                type='button'
                onClick={() => void handleDelete(alias.tw)}
                disabled={isLoading(`deleteTitleAlias-${alias.tw}`)}
                className={buttonStyles.dangerSmall}
              >
                刪除
              </button>
            </li>
          ))}
        </ul>
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
}
