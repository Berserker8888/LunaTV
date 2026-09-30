import { AdminConfig } from '@/lib/admin.types';

/**
 * 從 config 擷取「本區塊關心的欄位」並序列化，供草稿同步比對用。
 *
 * 背景：後台任一區塊儲存後都會呼叫 refreshConfig()，換掉整個 config
 * 物件的 identity。若各區塊只用 `config !== prevConfig`（identity 比對）
 * 來決定是否重設草稿，其他區塊正在編輯、尚未儲存的草稿會被無聲覆蓋。
 *
 * 解法：改比對本區塊欄位的實際內容簽名；欄位沒變就不碰草稿，
 * 只有本區塊的資料真的改變時才同步。
 */
export function configSliceSignature(
  config: AdminConfig | null,
  pick: (c: AdminConfig) => unknown
): string {
  if (!config) return '';
  try {
    return JSON.stringify(pick(config) ?? null);
  } catch {
    return '';
  }
}
