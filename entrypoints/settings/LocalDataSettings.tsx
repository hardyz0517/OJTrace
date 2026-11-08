import { useState } from "react";
import {
  createRuntimeMessage,
  sendRuntimeMessage,
} from "../shared/runtime-client";

export function LocalDataSettings({
  onUpdated: load,
}: {
  onUpdated: () => Promise<void>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<
    "accounts" | "submissions" | "all" | null
  >(null);
  const [clearBusy, setClearBusy] = useState(false);
  async function clearData(
    kind: "accounts" | "submissions" | "all",
  ): Promise<void> {
    if (clearBusy) return;
    setClearBusy(true);
    const type =
      kind === "accounts"
        ? "CLEAR_ACCOUNTS"
        : kind === "submissions"
          ? "CLEAR_SUBMISSIONS"
          : "CLEAR_DATA";
    try {
      const response = await sendRuntimeMessage(createRuntimeMessage({ type }));
      if (
        response.ok &&
        (response.type === "CLEARED" || response.type === "UPDATED")
      ) {
        setConfirmClear(null);
        setMessage(
          kind === "accounts"
            ? "账号配置和对应记录已清除。"
            : kind === "submissions"
              ? "提交记录已清除。"
              : "本地数据已清除。",
        );
        await load();
      } else if (!response.ok) {
        setMessage(response.error.message);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "清除失败，请稍后重试。",
      );
    } finally {
      setClearBusy(false);
    }
  }

  return (
    <>
      <section className="settings-section">
        <header className="settings-module-heading">
          <h1>本地数据</h1>
          <p>管理保存在此浏览器中的账号、提交记录、赛程缓存与偏好设置。</p>
        </header>
        <div className="privacy-row">
          <div>
            <h3>清理浏览器数据</h3>
            <p className="muted">
              提交历史、赛程缓存和账号配置仅保存在当前浏览器。
              <br />
              清除后无法恢复；清除全部还会重置采集策略与 CNOI 规则。
            </p>
          </div>
          <div className="privacy-actions">
            <button
              type="button"
              className="danger-outline"
              onClick={() => setConfirmClear("accounts")}
            >
              清除账号
            </button>
            <button
              type="button"
              className="danger-outline"
              onClick={() => setConfirmClear("submissions")}
            >
              清除记录
            </button>
            <button
              type="button"
              className="danger-outline"
              onClick={() => setConfirmClear("all")}
            >
              清除全部
            </button>
          </div>
        </div>
        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}
      </section>

      {confirmClear && (
        <div className="dialog-overlay">
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-data-title"
          >
            <h2 id="clear-data-title">
              {confirmClear === "accounts"
                ? "清除全部账号？"
                : confirmClear === "submissions"
                  ? "清除全部提交记录？"
                  : "清除全部本地数据？"}
            </h2>
            <p>
              {confirmClear === "accounts"
                ? "这将删除保存的账号配置及其提交记录。"
                : confirmClear === "submissions"
                  ? "这将删除所有已同步的提交记录，账号配置会保留。"
                  : "这将删除保存的账号、认证凭据、提交记录、赛程缓存及全部偏好设置（包括 CNOI 规则）。"}
              <br />
              此操作无法撤销。
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={clearBusy}
                onClick={() => setConfirmClear(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={clearBusy}
                onClick={() => void clearData(confirmClear)}
              >
                {clearBusy
                  ? "清除中…"
                  : confirmClear === "accounts"
                    ? "清除账号"
                    : confirmClear === "submissions"
                      ? "清除记录"
                      : "清除数据"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
