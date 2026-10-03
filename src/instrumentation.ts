/**
 * Next.js instrumentation hook：行程啟動時只執行一次的檢查。
 *
 * Next 15 起預設啟用，不需要在 next.config 額外設定。
 * 只在 nodejs runtime 跑（edge runtime 沒有 process.env 的完整語意）。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  checkTrustProxy();
  checkStorageTypeConsistency();
}

/**
 * 沒設 TRUST_PROXY 時，IP 維度的限流／封鎖會退化（getClientIp 回 'unknown'）。
 * 這是合法部署型態（直連），所以只警告不中斷啟動。
 */
function checkTrustProxy(): void {
  const normalized = process.env.TRUST_PROXY?.trim().toLowerCase();
  const enabled =
    normalized === 'true' || normalized === '1' || normalized === 'yes';
  if (!enabled) {
    console.warn(
      '[LunaTV] 未設定 TRUST_PROXY，來自反向代理的 X-Forwarded-For 將被忽略，' +
        'IP 維度的限流與封鎖不會生效。如經反向代理部署，請設定 TRUST_PROXY=true。'
    );
  }
}

/**
 * STORAGE_TYPE（伺服器端）與 NEXT_PUBLIC_STORAGE_TYPE（建置期內嵌給客戶端）
 * 不一致時，讀寫可能打到不同的後端。先 warn 一個版本再改 throw，
 * 因為 Dockerfile 寫死了 ENV NEXT_PUBLIC_STORAGE_TYPE=kvrocks，
 * 既有隻設 STORAGE_TYPE 的部署升級後會直接起不來。
 */
function checkStorageTypeConsistency(): void {
  const serverType = process.env.STORAGE_TYPE?.trim();
  const publicType = process.env.NEXT_PUBLIC_STORAGE_TYPE?.trim();
  if (serverType && publicType && serverType !== publicType) {
    console.warn(
      `[LunaTV] STORAGE_TYPE(${serverType}) 與 ` +
        `NEXT_PUBLIC_STORAGE_TYPE(${publicType}) 不一致，` +
        '伺服器端與客戶端可能讀寫不同的儲存後端。請將兩者設為相同值，' +
        '未來版本將改為直接報錯並拒絕啟動。'
    );
  }
}
