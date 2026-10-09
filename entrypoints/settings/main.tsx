import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { sourceDefinitions } from "../../src/sources/definitions";
import {
  createRuntimeMessage,
  sendRuntimeMessage,
} from "../shared/runtime-client";
import { AppHeader } from "../shared/AppHeader";
import { OJName } from "../shared/OJName";
import { AccountForm } from "./AccountForm";
import { PaginationSettings } from "./PaginationSettings";
import { modeLabel } from "./AccountAuthContent";
import {
  instanceBrandingFor,
  type PublicStoredData,
} from "../../src/application/accounts/account-queries";
import "./style.css";

function App() {
  const [data, setData] = useState<PublicStoredData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<
    "accounts" | "submissions" | "all" | null
  >(null);
  const [clearBusy, setClearBusy] = useState(false);
  const loadSequence = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    try {
      const response = await sendRuntimeMessage(
        createRuntimeMessage({ type: "GET_STATE" }),
      );
      if (sequence !== loadSequence.current) return;
      if (response.ok && response.type === "STATE") setData(response.data);
      else if (!response.ok) setMessage(response.error.message);
    } catch {
      if (sequence === loadSequence.current)
        setMessage("设置读取失败，请刷新后重试。");
    }
  }, []);

  useEffect(() => {
    void load();
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && Object.hasOwn(changes, "ojtrace:data"))
        void load();
    };
    browser.storage.onChanged.addListener(changed);
    return () => {
      browser.storage.onChanged.removeListener(changed);
      loadSequence.current += 1;
    };
  }, [load]);

  async function remove(accountId: string): Promise<void> {
    try {
      const response = await sendRuntimeMessage(
        createRuntimeMessage({ type: "DELETE_ACCOUNT", accountId }),
      );
      if (!response.ok) throw new Error(response.error.message);
      if (response.type === "UPDATED") await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "账号删除失败，请重试。",
      );
    }
  }

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
    <main className="settings-page">
      <AppHeader active="settings" />
      <div className="settings-content">
        <section className="settings-section">
          <div className="section-heading">
            <h2>账号</h2>
          </div>
          <AccountForm
            onAuthorized={() => {
              void load();
            }}
          />
          {message && <p className="message">{message}</p>}

          <h3 className="connected-title">已连接账号</h3>
          {!data?.accounts.length && <p className="muted">还没有账号。</p>}
          <ul className="accounts">
            {data?.accounts.map((account) => {
              const adapter = sourceDefinitions[account.source];
              const branding = instanceBrandingFor(data, account);
              const syncState = data.syncStates[account.accountId];
              const syncLabel =
                syncState?.lastAttemptAt === undefined
                  ? "尚未同步"
                  : syncState.stale
                    ? syncState.lastError
                      ? "最近同步失败"
                      : "范围未完整同步"
                    : syncState?.lastSuccessAt
                      ? "最近同步成功"
                      : "尚未同步";
              return (
                <li key={account.accountId}>
                  <i
                    className={`account-status-dot ${syncState?.stale ? "error" : "success"}`}
                    aria-hidden="true"
                  />
                  <div className="account-main">
                    <span className="badge">
                      <OJName
                        source={account.source}
                        size="small"
                        iconDataUrl={branding?.iconDataUrl}
                      >
                        {(account.source === "hydroj" &&
                          account.label?.trim()) ||
                          adapter?.metadata.displayName ||
                          account.source}
                      </OJName>
                    </span>
                    <div className="account-copy">
                      <strong>
                        {account.providerDisplayName ??
                          account.providerAccountKey}
                      </strong>
                      <span>
                        {modeLabel(account.authMode)} · {syncLabel}
                        {account.domainId && ` · ${account.domainId}`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="delete-account-button"
                    aria-label="删除账号"
                    title="删除账号"
                    onClick={() => void remove(account.accountId)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 7h16" />
                      <path d="M9 7V4h6v3" />
                      <path d="m7 7 1 13h8l1-13" />
                      <path d="M10 11v5M14 11v5" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {data && (
          <PaginationSettings preferences={data.preferences} onUpdated={load} />
        )}

        <section className="settings-section privacy-section">
          <div className="section-heading">
            <h2>数据与隐私</h2>
          </div>
          <div className="privacy-row">
            <div>
              <h3>本地数据</h3>
              <p className="muted">
                提交历史和账号配置仅保存在当前浏览器。
                <br />
                清除后无法恢复。
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
        </section>

        {confirmClear && (
          <div className="dialog-overlay">
            <div className="dialog" role="alertdialog" aria-modal="true">
              <h2>
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
                    : "这将删除保存的账号配置和所有已同步的提交记录。"}
                <br />
                此操作无法撤销。
              </p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
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
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
