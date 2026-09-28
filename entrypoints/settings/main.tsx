import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RuntimeResponse } from "../../src/application/messaging/messages";
import type { AccountConfig, SourceId, StoredData } from "../../src/domain";
import { requestSourcePermission } from "../../src/platform/permissions/hosts";
import "./style.css";

const sources: Array<{
  id: SourceId;
  label: string;
  authMode: AccountConfig["authMode"];
}> = [
  { id: "codeforces", label: "Codeforces", authMode: "public" },
  {
    id: "luogu",
    label: "Luogu（实验性，需登录）",
    authMode: "browser_session",
  },
  { id: "qoj", label: "QOJ（暂不可用）", authMode: "browser_session" },
  { id: "loj", label: "LibreOJ（暂不可用）", authMode: "browser_session" },
];

function send<T extends RuntimeResponse>(message: object): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

function App() {
  const [data, setData] = useState<StoredData | null>(null);
  const [source, setSource] = useState<SourceId>("codeforces");
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load(): Promise<void> {
    const response = await send<Extract<RuntimeResponse, { type: "STATE" }>>({
      schemaVersion: 1,
      type: "GET_STATE",
      requestId: crypto.randomUUID(),
    });
    if (response.ok) setData(response.data);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addAccount(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const value = identifier.trim();
    if (!value) return;
    const selected = sources.find((item) => item.id === source)!;
    const account: AccountConfig = {
      accountId: crypto.randomUUID(),
      source,
      identifier: value,
      enabled: false,
      authMode: selected.authMode,
    };
    const needsHostPermission = source === "codeforces" || source === "luogu";
    const granted = needsHostPermission
      ? await requestSourcePermission(source)
      : false;
    let notice: string | undefined;
    if (!needsHostPermission) {
      notice =
        "该来源目前没有可用的用户提交历史适配器，账号仅作占位保存。未申请站点权限。";
      account.enabled = false;
    } else if (!granted) {
      notice = "未授予站点访问权限，账号已保存但暂不启用。";
      account.enabled = false;
    } else {
      // Codeforces is the only stable, anonymous MVP source. Experimental and
      // unsupported sources stay disabled until their evidence is upgraded.
      account.enabled = source === "codeforces";
    }
    const response = await send<Extract<RuntimeResponse, { type: "UPDATED" }>>({
      schemaVersion: 1,
      type: "UPDATE_ACCOUNT",
      requestId: crypto.randomUUID(),
      account,
    });
    if (response.ok) {
      setData(response.data);
      setIdentifier("");
      setMessage(
        notice ??
          (account.enabled
            ? "账号已保存并启用。"
            : "账号已保存，当前保持停用。"),
      );
    }
  }

  async function remove(accountId: string): Promise<void> {
    const response = await send<Extract<RuntimeResponse, { type: "UPDATED" }>>({
      schemaVersion: 1,
      type: "DELETE_ACCOUNT",
      requestId: crypto.randomUUID(),
      accountId,
    });
    if (response.ok) setData(response.data);
  }

  return (
    <main className="settings-shell">
      <a href={browser.runtime.getURL("/timeline.html")}>← 返回时间线</a>
      <h1>设置</h1>
      <p className="muted">
        账号标识和提交记录只保存在当前浏览器。扩展不读取或保存完整 Cookie。
      </p>
      <form onSubmit={(event) => void addAccount(event)} className="form">
        <label>
          OJ
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as SourceId)}
          >
            {sources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          用户名 / Handle / UID
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="例如 tourist"
          />
        </label>
        <button type="submit">保存账号</button>
      </form>
      {message && <p className="message">{message}</p>}
      <section>
        <h2>已配置账号</h2>
        {!data?.accounts.length && <p className="muted">还没有账号。</p>}
        <ul className="accounts">
          {data?.accounts.map((account) => (
            <li key={account.accountId}>
              <span>
                <strong>
                  {sources.find((item) => item.id === account.source)?.label}
                </strong>{" "}
                · {account.identifier}
              </span>
              <button
                type="button"
                className="danger"
                onClick={() => void remove(account.accountId)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
