'use client';

import { AlertTriangle, Download, FileCheck, Lock, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { AlertModal, useAlertModal } from '@/app/admin/components/AlertModal';

interface DataMigrationProps {
  onRefreshConfig?: () => Promise<unknown>;
}

const DataMigration = ({ onRefreshConfig }: DataMigrationProps) => {
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 匯出資料
  const handleExport = async () => {
    if (!exportPassword.trim()) {
      showAlert({
        type: 'error',
        title: '錯誤',
        message: '請輸入加密密碼',
      });
      return;
    }

    try {
      setIsExporting(true);

      const response = await fetch('/api/admin/data_migration/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: exportPassword,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `匯出失敗: ${response.status}`);
      }

      // 取得檔案名
      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || 'moontv-backup.dat';

      // 下載檔案
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      a.style.position = 'fixed';
      a.style.top = '0';
      a.style.left = '0';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 延後釋放 blob URL。緊接在 click() 之後同步 revoke，部分瀏覽器
      // （Firefox 尤其明顯）會在下載真正開始讀取 blob 之前就把它回收掉，
      // 造成備份檔匯出失敗。
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);

      showAlert({
        type: 'success',
        title: '匯出成功',
        message: '資料已成功匯出，請妥善保管備份檔案和密碼',
        timer: 3000,
      });

      setExportPassword('');
    } catch (error) {
      showAlert({
        type: 'error',
        title: '匯出失敗',
        message: error instanceof Error ? error.message : '匯出過程中發生錯誤',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // 檔案選擇處理
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // 匯入資料
  const handleImport = async () => {
    if (!selectedFile) {
      showAlert({
        type: 'error',
        title: '錯誤',
        message: '請選擇備份檔案',
      });
      return;
    }

    if (!importPassword.trim()) {
      showAlert({
        type: 'error',
        title: '錯誤',
        message: '請輸入解密密碼',
      });
      return;
    }

    try {
      setIsImporting(true);

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('password', importPassword);

      const response = await fetch('/api/admin/data_migration/import', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `匯入失敗: ${response.status}`);
      }

      showAlert({
        type: 'success',
        title: '匯入成功',
        message: `匯入完成！\n匯入的使用者數量：${
          result.importedUsers
        }\n備份時間：${new Date(result.timestamp).toLocaleString(
          'zh-TW'
        )}\n伺服器版本：${
          result.serverVersion || '未知版本'
        }\n請重新整理頁面以查看最新資料。`,
        confirmText: '重新整理頁面',
        showConfirm: true,
        onConfirm: async () => {
          // 清理狀態
          setSelectedFile(null);
          setImportPassword('');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }

          // 重新整理設定
          if (onRefreshConfig) {
            await onRefreshConfig();
          }

          // 重新整理頁面
          window.location.reload();
        },
      });
    } catch (error) {
      showAlert({
        type: 'error',
        title: '匯入失敗',
        message: error instanceof Error ? error.message : '匯入過程中發生錯誤',
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <div className='max-w-6xl mx-auto space-y-6'>
        {/* 簡潔警告提示 */}
        <div className='flex items-center gap-3 p-4 border border-amber-200 dark:border-amber-700 rounded-lg bg-amber-50/30 dark:bg-amber-900/5'>
          <AlertTriangle className='w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0' />
          <p className='text-sm text-amber-800 dark:text-amber-200'>
            資料遷移操作請謹慎，確保已備份重要資料
          </p>
        </div>

        {/* 主要操作區域 - 響應式佈局 */}
        <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
          {/* 資料匯出 */}
          <div className='border border-zinc-200 dark:border-zinc-700 rounded-lg p-6 bg-white dark:bg-zinc-800 hover:shadow-sm transition-shadow flex flex-col'>
            <div className='flex items-center gap-3 mb-6'>
              <div className='w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center'>
                <Download className='w-4 h-4 text-blue-600 dark:text-blue-400' />
              </div>
              <div>
                <h3 className='font-semibold text-zinc-900 dark:text-zinc-100'>
                  資料匯出
                </h3>
                <p className='text-sm text-zinc-600 dark:text-zinc-400'>
                  創建加密備份檔案
                </p>
              </div>
            </div>

            <div className='flex-1 flex flex-col'>
              <div className='space-y-4'>
                {/* 密碼輸入 */}
                <div>
                  <label className='flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
                    <Lock className='w-4 h-4' />
                    加密密碼
                  </label>
                  <input
                    type='password'
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    placeholder='設定強密碼保護備份檔案'
                    className='w-full px-3 py-2.5 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors'
                    disabled={isExporting}
                  />
                  <p className='text-xs text-zinc-500 dark:text-zinc-400 mt-1'>
                    匯入時需要使用相同密碼
                  </p>
                </div>

                {/* 備份內容列表 */}
                <div className='text-xs text-zinc-600 dark:text-zinc-400 space-y-1'>
                  <p className='font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
                    備份內容：
                  </p>
                  <div className='grid grid-cols-2 gap-1'>
                    <div>• 管理設定</div>
                    <div>• 使用者資料</div>
                    <div>• 播放記錄</div>
                    <div>• 收藏夾</div>
                  </div>
                </div>
              </div>

              {/* 匯出按鈕 */}
              <button
                onClick={handleExport}
                disabled={isExporting || !exportPassword.trim()}
                className={`w-full px-4 py-2.5 rounded-lg font-medium transition-colors mt-10 ${
                  isExporting || !exportPassword.trim()
                    ? 'bg-zinc-100 dark:bg-zinc-700 cursor-not-allowed text-zinc-500 dark:text-zinc-400'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isExporting ? (
                  <div className='flex items-center justify-center gap-2'>
                    <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                    匯出中...
                  </div>
                ) : (
                  <div className='flex items-center justify-center gap-2'>
                    <Download className='w-4 h-4' />
                    匯出資料
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* 資料匯入 */}
          <div className='border border-zinc-200 dark:border-zinc-700 rounded-lg p-6 bg-white dark:bg-zinc-800 hover:shadow-sm transition-shadow flex flex-col'>
            <div className='flex items-center gap-3 mb-6'>
              <div className='w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center'>
                <Upload className='w-4 h-4 text-red-600 dark:text-red-400' />
              </div>
              <div>
                <h3 className='font-semibold text-zinc-900 dark:text-zinc-100'>
                  資料匯入
                </h3>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  ⚠️ 將清空現有資料
                </p>
              </div>
            </div>

            <div className='flex-1 flex flex-col'>
              <div className='space-y-4'>
                {/* 檔案選擇 */}
                <div>
                  <label className='flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
                    <FileCheck className='w-4 h-4' />
                    備份檔案
                    {selectedFile && (
                      <span className='ml-auto text-xs text-green-600 dark:text-green-400 font-normal'>
                        {selectedFile.name} (
                        {(selectedFile.size / 1024).toFixed(1)} KB)
                      </span>
                    )}
                  </label>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='.dat'
                    onChange={handleFileSelect}
                    className='w-full px-3 py-2.5 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-red-500 focus:border-red-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-zinc-50 dark:file:bg-zinc-600 file:text-zinc-700 dark:file:text-zinc-300 hover:file:bg-zinc-100 dark:hover:file:bg-zinc-500 transition-colors'
                    disabled={isImporting}
                  />
                </div>

                {/* 密碼輸入 */}
                <div>
                  <label className='flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
                    <Lock className='w-4 h-4' />
                    解密密碼
                  </label>
                  <input
                    type='password'
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder='輸入匯出時的加密密碼'
                    className='w-full px-3 py-2.5 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors'
                    disabled={isImporting}
                  />
                </div>
              </div>

              {/* 匯入按鈕 */}
              <button
                onClick={handleImport}
                disabled={
                  isImporting || !selectedFile || !importPassword.trim()
                }
                className={`w-full px-4 py-2.5 rounded-lg font-medium transition-colors mt-10 ${
                  isImporting || !selectedFile || !importPassword.trim()
                    ? 'bg-zinc-100 dark:bg-zinc-700 cursor-not-allowed text-zinc-500 dark:text-zinc-400'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {isImporting ? (
                  <div className='flex items-center justify-center gap-2'>
                    <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                    匯入中...
                  </div>
                ) : (
                  <div className='flex items-center justify-center gap-2'>
                    <Upload className='w-4 h-4' />
                    匯入資料
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 彈窗組件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        confirmText={alertModal.confirmText}
        onConfirm={alertModal.onConfirm}
        showConfirm={alertModal.showConfirm}
        timer={alertModal.timer}
      />
    </>
  );
};

export default DataMigration;
