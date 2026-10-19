import { CheckCircle2, Eye, EyeOff, Server, Sparkles } from 'lucide-react';
import React, { useState } from 'react';

import { AdminConfig, EmbyConfig } from '@/lib/admin.types';

import {
  AlertModal,
  showError,
  showSuccess,
  useAlertModal,
} from './AlertModal';
import { buttonStyles } from './buttonStyles';
import { useLoadingState } from './Loading';

export const EmbyConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<boolean>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();

  const [embySettings, setEmbySettings] = useState<EmbyConfig>(() => ({
    enabled: config?.EmbyConfig?.enabled ?? false,
    serverUrl: config?.EmbyConfig?.serverUrl || '',
    username: config?.EmbyConfig?.username || '',
    password: config?.EmbyConfig?.password || '',
    name: config?.EmbyConfig?.name || 'Emby 影庫',
    tag: config?.EmbyConfig?.tag || '4K原畫',
  }));

  const [prevConfig, setPrevConfig] = useState(config?.EmbyConfig);
  if (config?.EmbyConfig !== prevConfig) {
    setPrevConfig(config?.EmbyConfig);
    setEmbySettings({
      enabled: config?.EmbyConfig?.enabled ?? false,
      serverUrl: config?.EmbyConfig?.serverUrl || '',
      username: config?.EmbyConfig?.username || '',
      password: config?.EmbyConfig?.password || '',
      name: config?.EmbyConfig?.name || 'Emby 影庫',
      tag: config?.EmbyConfig?.tag || '4K原畫',
    });
  }

  const [showPassword, setShowPassword] = useState(false);

  const handleTestConnection = async () => {
    if (!embySettings.serverUrl) {
      showAlert({
        type: 'warning',
        title: '缺少網址',
        message: '請先輸入 Emby 伺服器網址',
      });
      return;
    }

    try {
      const data = await withLoading('testEmby', async () => {
        const res = await fetch('/api/admin/emby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'test',
            serverUrl: embySettings.serverUrl,
            username: embySettings.username,
            password: embySettings.password,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || '連線測試失敗');
        }

        return await res.json();
      });

      if (data.success) {
        showSuccess(
          `連線成功！${data.serverName ? `伺服器：${data.serverName} ` : ''}${data.version ? `(v${data.version})` : ''}`,
          showAlert
        );
      } else {
        showError(data.message || '連線失敗', showAlert);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '連線失敗', showAlert);
    }
  };

  const handleSave = async () => {
    try {
      await withLoading('saveEmby', async () => {
        const res = await fetch('/api/admin/emby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            ...embySettings,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || '儲存設定失敗');
        }

        await refreshConfig();
        showSuccess('Emby 影庫設定已儲存', showAlert);
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : '儲存失敗', showAlert);
    }
  };

  return (
    <div className='space-y-6'>
      <div className='p-6 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 space-y-6'>
        {/* 標題與啟用切換開關 */}
        <div className='flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-700'>
          <div className='flex items-center space-x-3'>
            <div className='p-2 bg-emerald-500/10 text-emerald-500 rounded-lg'>
              <Server size={22} />
            </div>
            <div>
              <h3 className='text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2'>
                Emby 私人影庫 / 公費服
                <span className='px-2 py-0.5 text-xs font-normal rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'>
                  直連原畫
                </span>
              </h3>
              <p className='text-xs text-zinc-500 dark:text-zinc-400 mt-0.5'>
                無縫接入你的 Emby 影庫，搜尋自動聚合、直連原畫播放、免轉碼消耗
              </p>
            </div>
          </div>

          <label className='relative inline-flex items-center cursor-pointer'>
            <input
              type='checkbox'
              checked={embySettings.enabled}
              onChange={(e) =>
                setEmbySettings((prev) => ({
                  ...prev,
                  enabled: e.target.checked,
                }))
              }
              className='sr-only peer'
            />
            <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-emerald-600"></div>
          </label>
        </div>

        {/* 表單主體 */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-5'>
          <div className='space-y-1.5 md:col-span-2'>
            <label className='block text-xs font-medium text-zinc-700 dark:text-zinc-300'>
              伺服器網址 <span className='text-red-500'>*</span>
            </label>
            <input
              type='text'
              value={embySettings.serverUrl}
              onChange={(e) =>
                setEmbySettings((prev) => ({
                  ...prev,
                  serverUrl: e.target.value,
                }))
              }
              placeholder='例：https://emby.myline.com:443 或 http://192.168.1.100:8096'
              className='w-full px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50'
            />
          </div>

          <div className='space-y-1.5'>
            <label className='block text-xs font-medium text-zinc-700 dark:text-zinc-300'>
              帳號 (Username)
            </label>
            <input
              type='text'
              value={embySettings.username}
              onChange={(e) =>
                setEmbySettings((prev) => ({
                  ...prev,
                  username: e.target.value,
                }))
              }
              placeholder='公費服或自建服帳號'
              className='w-full px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50'
            />
          </div>

          <div className='space-y-1.5'>
            <label className='block text-xs font-medium text-zinc-700 dark:text-zinc-300'>
              密碼 (Password)
            </label>
            <div className='relative'>
              <input
                type={showPassword ? 'text' : 'password'}
                value={embySettings.password || ''}
                onChange={(e) =>
                  setEmbySettings((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                placeholder='帳號密碼（若無密碼可留空）'
                className='w-full px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 pr-10'
              />
              <button
                type='button'
                onClick={() => setShowPassword((prev) => !prev)}
                className='absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className='space-y-1.5'>
            <label className='block text-xs font-medium text-zinc-700 dark:text-zinc-300'>
              顯示名稱
            </label>
            <input
              type='text'
              value={embySettings.name || ''}
              onChange={(e) =>
                setEmbySettings((prev) => ({
                  ...prev,
                  name: e.target.value,
                }))
              }
              placeholder='例：Emby 公費服'
              className='w-full px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50'
            />
          </div>

          <div className='space-y-1.5'>
            <label className='block text-xs font-medium text-zinc-700 dark:text-zinc-300'>
              線路標籤
            </label>
            <input
              type='text'
              value={embySettings.tag || ''}
              onChange={(e) =>
                setEmbySettings((prev) => ({
                  ...prev,
                  tag: e.target.value,
                }))
              }
              placeholder='例：4K原畫、秒播、VIP'
              className='w-full px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50'
            />
          </div>
        </div>

        {/* 提示區塊 */}
        <div className='p-4 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 text-xs text-zinc-600 dark:text-zinc-300 space-y-2'>
          <div className='flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300'>
            <Sparkles size={16} />
            <span>特點與播放指南</span>
          </div>
          <ul className='list-disc list-inside space-y-1 pl-1 text-[13px] text-zinc-700 dark:text-zinc-300'>
            <li>
              <strong>流量零負擔</strong>：影片串流由本地裝置直連 Emby
              伺服器，完全不經過 LunaTV 伺服器，不佔用你的 VPS 或主機流量。
            </li>
            <li>
              <strong>智慧片名聚合</strong>
              ：搜尋《玩命關頭》或《間諜家家酒》時，LunaTV
              會自動將兩岸不同譯名轉換後發送給 Emby，並在結果列表中優先呈現。
            </li>
            <li>
              <strong>外部播放器免轉碼</strong>：遇 4K Remux、原盤 MKV
              或杜比視界（Dolby Vision）等高碼率編碼時，可隨時點擊播放器下方的「
              <strong>外部播放器</strong>
              」按鈕（PotPlayer、IINA、Infuse、VLC），滿血硬解原畫播放，不耗費服主轉碼資源。
            </li>
          </ul>
        </div>

        {/* 操作按鈕 */}
        <div className='flex flex-col sm:flex-row items-center justify-end gap-3 pt-2'>
          <button
            type='button'
            onClick={handleTestConnection}
            disabled={isLoading('testEmby') || !embySettings.serverUrl}
            className={`w-full sm:w-auto px-4 py-2 text-sm rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              isLoading('testEmby') || !embySettings.serverUrl
                ? buttonStyles.disabled
                : buttonStyles.secondary
            }`}
          >
            {isLoading('testEmby') ? (
              <>
                <div className='w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin'></div>
                <span>測試中...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                <span>測試連線</span>
              </>
            )}
          </button>

          <button
            type='button'
            onClick={handleSave}
            disabled={isLoading('saveEmby')}
            className={`w-full sm:w-auto px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
              isLoading('saveEmby')
                ? buttonStyles.disabled
                : buttonStyles.success
            }`}
          >
            {isLoading('saveEmby') ? '儲存中...' : '儲存 Emby 設定'}
          </button>
        </div>
      </div>

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
};
