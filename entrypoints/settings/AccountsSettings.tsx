import { useState } from "react";
import type { PublicStoredData } from "../../src/application/accounts/account-queries";
import {
  createRuntimeMessage,
  sendRuntimeMessage,
} from "../shared/runtime-client";
import { sourceDefinitions } from "../../src/sources/definitions";
import { instanceBrandingFor } from "../../src/application/accounts/account-queries";
import { OJName } from "../shared/OJName";
import { AccountForm } from "./AccountForm";
import { modeLabel } from "./AccountAuthContent";

export function AccountsSettings({
  data,
  onUpdated: load,
  onDirtyChange,
}: {
  data: PublicStoredData | null;
  onUpdated: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
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

  return (
    <section className="settings-section">
      <header className="settings-module-heading">
        <h1>OJ 账号</h1>
        <p>管理账号接入与认证。账号配置仅保存在当前浏览器。</p>
      </header>
      <AccountForm
        onDirtyChange={onDirtyChange}
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
                    {(account.source === "hydroj" && account.label?.trim()) ||
                      adapter?.metadata.displayName ||
                      account.source}
                  </OJName>
                </span>
                <div className="account-copy">
                  <strong>
                    {account.providerDisplayName ?? account.providerAccountKey}
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
  );
}
