import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { adapterBySource, adapters } from "../../src/adapters";
import type { RuntimeResponse } from "../../src/application/messaging/messages";
import {
  normalizeAuthMode,
  type AccountAuthMode,
  type BrowserSessionAccount,
  type SourceId,
  type StoredData,
} from "../../src/domain";
import { AppHeader } from "../shared/AppHeader";
import { AnimatedSelect } from "../shared/AnimatedSelect";
import { OJLogo } from "../shared/OJLogo";
import { createHydroOJInstance } from "../../src/adapters/hydroj/instance";
import {
  ensureAdapterDataPermission,
  ensureSourcePermission,
  hasExactOriginPermission,
  requestExactOriginPermission,
} from "../../src/platform/permissions/hosts";
import "./style.css";

const sourceOptions = adapters.map((adapter) => ({
  id: adapter.metadata.id,
  label: adapter.metadata.displayName,
}));

function send<T extends RuntimeResponse>(message: object): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

async function detectBrowserSession(
  source: SourceId,
  origin: string,
): Promise<RuntimeResponse> {
  const request = () =>
    send<RuntimeResponse>({
      schemaVersion: 1,
      type: "DETECT_BROWSER_SESSION",
      requestId: crypto.randomUUID(),
      source,
      ...(source === "hydroj" && origin.trim()
        ? { origin: createHydroOJInstance(origin).origin }
        : {}),
    });

  return request();
}

function defaultAuthMode(source: SourceId): AccountAuthMode | null {
  const modes = adapterBySource.get(source)?.metadata.authModes ?? [];
  return modes.find((mode) => mode.recommended)?.type ?? modes[0]?.type ?? null;
}

function modeLabel(mode: AccountAuthMode): string {
  switch (mode) {
    case "public-handle":
      return "直接输入用户名";
    case "browser-session":
      return "浏览器授权";
    case "manual-cookie":
      return "Cookie 登录";
    case "password":
      return "账号密码";
  }
  return mode;
}

function OJName({
  source,
  children,
}: {
  source: SourceId;
  children: React.ReactNode;
}) {
  return (
    <span className="oj-name">
      <OJLogo source={source} size="small" />
      <span>{children}</span>
    </span>
  );
}

function SessionStatus({
  state,
  onRetry,
}: {
  state: "checking" | BrowserSessionAccount | null;
  onRetry: () => void;
}) {
  if (state === "checking") {
    return <p className="session-status is-checking">正在检测登录状态...</p>;
  }
  if (!state) return null;
  if (state.authenticated) {
    return (
      <p className="session-status is-authenticated">
        <span className="status-mark" aria-hidden="true">
          ●
        </span>
        已检测到登录账号 <strong>{state.username ?? state.uid}</strong>
      </p>
    );
  }
  if (state.status === "permission-denied") {
    return (
      <div className="session-status-block">
        <p className="session-status is-error">
          未授予站点权限，无法检测登录状态。
        </p>
        <button
          type="button"
          className="text-button"
          onClick={() => void onRetry()}
        >
          授权并重新检测
        </button>
      </div>
    );
  }
  if (state.status === "network-error" || state.status === "site-error") {
    return (
      <div className="session-status-block">
        <p className="session-status is-error">暂时无法检测登录状态</p>
        <p className="session-help">请稍后重试，或使用手动配置。</p>
        {state.diagnostic ? (
          <p className="session-help">诊断：{state.diagnostic}</p>
        ) : null}
        <button
          type="button"
          className="text-button"
          onClick={() => void onRetry()}
        >
          重新检测
        </button>
      </div>
    );
  }
  if (state.status === "browser-cookie-unavailable") {
    return (
      <div className="session-status-block">
        <p className="session-status is-error">
          读取不到 QOJ 浏览器登录 Cookie
        </p>
        <p className="session-help">
          请在 qoj.ac 登录后重新加载扩展，并确认 qoj.ac
          站点权限已开启；也可以切换到 Cookie 登录。
        </p>
        {state.diagnostic ? (
          <p className="session-help">诊断：{state.diagnostic}</p>
        ) : null}
        <button
          type="button"
          className="text-button"
          onClick={() => void onRetry()}
        >
          重新检测
        </button>
      </div>
    );
  }
  if (state.status === "unsupported") {
    return (
      <p className="session-status is-error">
        该 OJ 暂不支持浏览器登录态检测。
      </p>
    );
  }
  return (
    <div className="session-status-block">
      <p className="session-status is-unauthenticated">
        ○ 当前浏览器未检测到登录账号
      </p>
      <p className="session-help">请先在浏览器中登录后重新检测。</p>
      <button type="button" className="text-button" onClick={onRetry}>
        重新检测
      </button>
    </div>
  );
}

function App() {
  const [data, setData] = useState<StoredData | null>(null);
  const [source, setSource] = useState<SourceId>("codeforces");
  const [authMode, setAuthMode] = useState<AccountAuthMode | null>(
    defaultAuthMode("codeforces"),
  );
  const [identifier, setIdentifier] = useState("");
  const [origin, setOrigin] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [session, setSession] = useState<
    "checking" | BrowserSessionAccount | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState<
    "accounts" | "submissions" | "all" | null
  >(null);
  const [clearBusy, setClearBusy] = useState(false);
  const selectedAdapter = adapterBySource.get(source);
  const modeDefinitions = selectedAdapter?.metadata.authModes ?? [];
  const selectedMode = modeDefinitions.find((mode) => mode.type === authMode);
  const manualMode = modeDefinitions.find(
    (mode) => mode.type === "manual-cookie",
  );
  const manualCredentialFields = manualMode?.credentialFields ?? [];
  const manualIdentifierRequired = manualMode?.identifierRequired !== false;
  const passwordMode = modeDefinitions.find((mode) => mode.type === "password");
  const passwordCredentialFields = passwordMode?.credentialFields ?? [];
  const modeChoices = modeDefinitions.map((mode) => ({
    value: mode.type,
    label: mode.label ?? modeLabel(mode.type),
  }));

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

  useEffect(() => {
    const nextMode = defaultAuthMode(source);
    setAuthMode(nextMode);
    setIdentifier("");
    setOrigin("");
    setCredentials({});
    setMessage(null);
    setSession(null);
  }, [source]);

  useEffect(() => {
    if (
      authMode !== "browser-session" ||
      !modeDefinitions.some((mode) => mode.type === authMode)
    ) {
      setSession(null);
      return;
    }
    let cancelled = false;
    setSession("checking");
    void detectBrowserSession(source, origin).then((response) => {
      if (cancelled) return;
      setSession(
        response.ok && response.type === "BROWSER_SESSION"
          ? response.account
          : {
              authenticated: false,
              status: "site-error",
              diagnostic: response.ok
                ? `runtime-type=${response.type}`
                : `runtime-error=${response.error.code}: ${response.error.message}`,
            },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [source, authMode, origin, modeDefinitions]);

  async function detectAgain(): Promise<void> {
    if (source === "hydroj" && !origin.trim()) {
      setMessage("请输入 HydroOJ 实例地址。");
      return;
    }
    setSession("checking");
    const response = await detectBrowserSession(source, origin);
    setSession(
      response.ok && response.type === "BROWSER_SESSION"
        ? response.account
        : {
            authenticated: false,
            status: "site-error",
            diagnostic: response.ok
              ? `runtime-type=${response.type}`
              : `runtime-error=${response.error.code}: ${response.error.message}`,
          },
    );
  }

  async function requestPermissionAndDetect(): Promise<void> {
    try {
      const granted = await ensureSourcePermission(source);
      if (!granted) {
        setSession({
          authenticated: false,
          status: "permission-denied",
          diagnostic: "permissions.request returned false",
        });
        return;
      }
      await detectAgain();
    } catch (error) {
      setSession({
        authenticated: false,
        status: "site-error",
        diagnostic:
          error instanceof Error ? error.message : "permission request failed",
      });
    }
  }

  function selectMode(mode: AccountAuthMode): void {
    setAuthMode(mode);
    setSession(null);
    setMessage(null);
  }

  async function addAccount(
    event: React.FormEvent | null,
    requestedMode: AccountAuthMode = authMode ?? "public-handle",
  ): Promise<void> {
    event?.preventDefault();
    if (busy) return;
    const mode = requestedMode;
    setBusy(true);
    setMessage(null);
    try {
      let value = identifier.trim();
      if (mode === "public-handle" && !value) {
        setMessage("请输入用户名。");
        return;
      }
      if (source === "hydroj" && !origin.trim()) {
        setMessage("请输入 HydroOJ 实例地址。");
        return;
      }
      if (mode === "browser-session") {
        if (!session || session === "checking" || !session.authenticated) {
          setMessage("未检测到登录状态，请先登录后重新检测。");
          return;
        }
        value = session.uid ?? session.username ?? "";
      }
      if (
        (mode === "manual-cookie" || mode === "password") &&
        ((mode === "manual-cookie" && manualIdentifierRequired && !value) ||
          (mode === "manual-cookie"
            ? manualCredentialFields
            : passwordCredentialFields
          ).some(
            (field) =>
              field.required !== false && !credentials[field.key]?.trim(),
          ))
      ) {
        setMessage(
          manualIdentifierRequired
            ? "请填写账号标识和全部必需凭证。"
            : "请填写全部必需凭证。",
        );
        return;
      }
      const normalizedOrigin =
        source === "hydroj" && origin.trim()
          ? createHydroOJInstance(origin).origin
          : undefined;
      const sourceGranted = normalizedOrigin
        ? (await hasExactOriginPermission(normalizedOrigin)) ||
          (await requestExactOriginPermission(normalizedOrigin))
        : mode === "manual-cookie"
          ? await ensureSourcePermission(source)
          : true;
      if (!sourceGranted) {
        setMessage("未授予该 OJ 站点权限，无法读取登录态。");
        return;
      }
      const dataGranted =
        mode === "public-handle"
          ? true
          : await ensureAdapterDataPermission(source, {
              includeSource: false,
              origins:
                source === "atcoder" && mode === "manual-cookie"
                  ? ["https://kenkoooo.com/*", "https://atcoder.jp/*"]
                  : undefined,
            });
      if (!dataGranted) {
        setMessage("未授予数据站点权限，无法获取提交记录。");
        return;
      }
      const response = await send<RuntimeResponse>({
        schemaVersion: 1,
        type: "AUTHORIZE_ACCOUNT",
        requestId: crypto.randomUUID(),
        source,
        authMode: mode,
        identifier: value,
        ...(normalizedOrigin ? { origin: normalizedOrigin } : {}),
        permissionsGranted: true,
        ...(mode === "manual-cookie" || mode === "password"
          ? {
              credentials: Object.fromEntries(
                (mode === "manual-cookie"
                  ? manualCredentialFields
                  : passwordCredentialFields
                )
                  .map((field) => [
                    field.key,
                    credentials[field.key]?.trim() ?? "",
                  ])
                  .filter(([, value]) => Boolean(value)),
              ),
            }
          : {}),
      });
      if (response.ok && response.type === "AUTHORIZED") {
        setData(response.data);
        setIdentifier("");
        setOrigin("");
        setCredentials({});
        setMessage(
          mode === "browser-session"
            ? "账号已授权并添加。"
            : response.account.enabled
              ? "账号已添加。"
              : "账号已添加，但尚未授予站点权限。",
        );
      } else if (!response.ok) {
        setMessage(response.error.message);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "操作失败，请稍后重试。",
      );
    } finally {
      setBusy(false);
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
    const response = await send<RuntimeResponse>({
      schemaVersion: 1,
      type,
      requestId: crypto.randomUUID(),
    });
    try {
      if (response.ok) {
        setConfirmClear(null);
        setMessage(
          kind === "accounts"
            ? "账号配置和对应记录已清除。"
            : kind === "submissions"
              ? "提交记录已清除。"
              : "本地数据已清除。",
        );
        await load();
      } else {
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

  const sourceChoices = useMemo(
    () =>
      sourceOptions.map(({ id, label }) => ({
        value: id,
        label: <OJName source={id}>{label}</OJName>,
      })),
    [],
  );

  return (
    <main className="settings-page">
      <AppHeader active="settings" />
      <div className="settings-content">
        <section className="settings-section">
          <div className="section-heading">
            <h2>账号</h2>
          </div>
          <div className="account-setup">
            <h3>添加账号</h3>
            <form
              onSubmit={(event) => void addAccount(event)}
              className="account-form"
            >
              <label className="source-field">
                <span>平台</span>
                <AnimatedSelect
                  label="选择平台"
                  value={source}
                  options={sourceChoices}
                  onChange={setSource}
                />
              </label>

              {!modeDefinitions.length && (
                <div className="unavailable-panel">
                  <strong>该 OJ 暂无可用的账号接入方式</strong>
                  <p>当前 Adapter 尚未提供可验证的提交历史同步能力。</p>
                </div>
              )}

              {source === "hydroj" && modeDefinitions.length > 0 && (
                <div className="auth-panel public-panel">
                  <label>
                    <span>HydroOJ 实例地址</span>
                    <input
                      value={origin}
                      onChange={(event) => setOrigin(event.target.value)}
                      placeholder="例如 http://106.55.100.251"
                      autoComplete="off"
                    />
                  </label>
                  <p className="auth-description">
                    仅访问你输入的单个实例，不会申请泛域名权限。
                  </p>
                </div>
              )}

              {modeDefinitions.length > 1 && (
                <label className="source-field auth-mode-field">
                  <span>方式</span>
                  <AnimatedSelect
                    label="选择方式"
                    value={authMode ?? modeDefinitions[0]!.type}
                    options={modeChoices}
                    onChange={selectMode}
                  />
                </label>
              )}

              {authMode === "public-handle" && selectedMode && (
                <div className="auth-panel public-panel">
                  <label>
                    <span>用户名</span>
                    <input
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      placeholder="例如 tourist"
                      autoComplete="off"
                    />
                  </label>
                  <p className="auth-description">
                    {selectedMode.description ??
                      "使用公开账号信息获取提交记录，无需登录授权。"}
                  </p>
                  <div className="auth-panel-actions">
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={busy}
                    >
                      {busy ? "处理中..." : "添加账号"}
                    </button>
                  </div>
                </div>
              )}

              {modeDefinitions.length > 0 && authMode !== "public-handle" && (
                <div className="auth-methods">
                  {authMode === "browser-session" &&
                    modeDefinitions.some(
                      (mode) => mode.type === "browser-session",
                    ) && (
                      <div className="auth-panel browser-panel">
                        <div className="auth-panel-heading">
                          <div className="auth-heading-title">
                            <h4>使用当前浏览器登录状态</h4>
                            {modeDefinitions.find(
                              (mode) => mode.type === "browser-session",
                            )?.recommended && (
                              <span className="recommended-badge">推荐</span>
                            )}
                          </div>
                        </div>
                        <div className="session-status-area">
                          <SessionStatus
                            state={session}
                            onRetry={() => void requestPermissionAndDetect()}
                          />
                        </div>
                        <div className="auth-panel-actions browser-actions">
                          <button
                            type="button"
                            className="primary-button"
                            disabled={busy}
                            onClick={() =>
                              void addAccount(null, "browser-session")
                            }
                          >
                            {busy && authMode === "browser-session"
                              ? "处理中..."
                              : "授权并添加"}
                          </button>
                        </div>
                      </div>
                    )}

                  {authMode === "manual-cookie" && manualMode && (
                    <div className="auth-panel manual-panel">
                      <div className="auth-panel-heading">
                        <h4>{manualMode.label ?? "手动配置"}</h4>
                        <p>{manualMode.description}</p>
                        {source === "atcoder" && (
                          <p className="auth-description">
                            Cookie 仅用于官方 AtCoder
                            身份识别，不会上传到提交数据服务。
                          </p>
                        )}
                      </div>
                      {manualIdentifierRequired && (
                        <label>
                          <span>
                            {manualMode.identifierLabel ?? "UID / 用户名"}
                          </span>
                          <input
                            value={identifier}
                            onChange={(event) =>
                              setIdentifier(event.target.value)
                            }
                            placeholder="例如 123456"
                            autoComplete="off"
                          />
                        </label>
                      )}
                      {manualCredentialFields.map((field) => (
                        <label key={field.key}>
                          <span>{field.label}</span>
                          <input
                            type={field.type ?? "password"}
                            value={credentials[field.key] ?? ""}
                            onChange={(event) =>
                              setCredentials((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                            placeholder={field.placeholder}
                            autoComplete="off"
                          />
                        </label>
                      ))}
                      <div className="auth-panel-actions">
                        <button
                          type="button"
                          className="primary-button"
                          disabled={busy}
                          onClick={() => void addAccount(null, "manual-cookie")}
                        >
                          {busy ? "处理中..." : "添加账号"}
                        </button>
                      </div>
                    </div>
                  )}

                  {authMode === "password" && passwordMode && (
                    <div className="auth-panel manual-panel password-panel">
                      <div className="auth-panel-heading">
                        <h4>{passwordMode.label ?? "账号密码登录"}</h4>
                        <p>{passwordMode.description}</p>
                      </div>
                      {passwordCredentialFields.map((field) => (
                        <label key={field.key}>
                          <span>{field.label}</span>
                          <input
                            type={field.type ?? "password"}
                            value={credentials[field.key] ?? ""}
                            onChange={(event) =>
                              setCredentials((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                            placeholder={field.placeholder}
                            autoComplete={
                              field.key === "password"
                                ? "current-password"
                                : "username"
                            }
                          />
                        </label>
                      ))}
                      <div className="auth-panel-actions">
                        <button
                          type="button"
                          className="primary-button"
                          disabled={busy}
                          onClick={() => void addAccount(null, "password")}
                        >
                          {busy ? "登录中..." : "登录并添加"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </form>
          </div>
          {message && <p className="message">{message}</p>}

          <h3 className="connected-title">已连接账号</h3>
          {!data?.accounts.length && <p className="muted">还没有账号。</p>}
          <ul className="accounts">
            {data?.accounts.map((account) => {
              const adapter = adapterBySource.get(account.source);
              const syncState = data.syncStates[account.accountId];
              const normalizedMode = normalizeAuthMode(account.authMode);
              const syncLabel = syncState?.stale
                ? "最近同步失败"
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
                      <OJName source={account.source}>
                        {adapter?.metadata.displayName ?? account.source}
                      </OJName>
                    </span>
                    <div className="account-copy">
                      <strong>
                        {account.providerDisplayName ?? account.identifier}
                      </strong>
                      <span>
                        {modeLabel(normalizedMode)} · {syncLabel}
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
