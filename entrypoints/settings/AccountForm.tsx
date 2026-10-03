import { adapters } from "../../src/adapters";
import type { AccountAuthMode, BrowserSessionAccount } from "../../src/domain";
import { AnimatedSelect } from "../shared/AnimatedSelect";
import { OJName } from "../shared/OJName";
import {
  useAccountAuthorization,
  type AuthorizedResponse,
} from "./useAccountAuthorization";

export function modeLabel(mode: AccountAuthMode): string {
  return {
    "public-handle": "直接输入用户名",
    "browser-session": "浏览器授权",
    "manual-cookie": "手动配置",
    password: "账号密码",
  }[mode];
}

function sessionStatusText(
  session: "checking" | BrowserSessionAccount | null,
): string {
  if (session === "checking") return "正在检测登录状态…";
  if (session?.authenticated)
    return `已检测到登录账号 ${session.username ?? session.uid}`;
  if (session?.status === "permission-denied")
    return "请授予该站点的访问权限。";
  const diagnostic = session?.diagnostic ?? "";
  if (diagnostic.includes("code=cookie-restoration"))
    return "请求后恢复 Cookie 失败，请查看诊断信息。";
  if (diagnostic.includes("code=cookie-injection"))
    return "无法准备后台请求所需的登录 Cookie。";
  if (
    diagnostic.includes("cookie-store-read-failed") ||
    diagnostic.includes("code=cookie-read")
  )
    return "无法读取浏览器中的 QOJ 登录 Cookie。";
  if (diagnostic.includes("qoj-cloudflare-challenge"))
    return "QOJ 的 Cloudflare 拦截了后台检测请求。";
  if (diagnostic.includes("qoj-forbidden"))
    return "QOJ 拒绝了后台检测请求（HTTP 403）。";
  if (diagnostic.includes("qoj-rate-limited"))
    return "QOJ 请求过于频繁（HTTP 429），请稍后重试。";
  if (diagnostic.includes("qoj-identity-missing"))
    return "QOJ 页面已返回，但无法解析登录账号。";
  if (session?.status === "network-error")
    return "后台网络请求失败，请查看诊断信息。";
  if (session?.status === "site-error") return "登录检测失败，请查看诊断信息。";
  return "请先在浏览器中登录该站点。";
}

export function AccountForm({
  onAuthorized,
}: {
  onAuthorized: (response: AuthorizedResponse) => void;
}) {
  const state = useAccountAuthorization(onAuthorized);
  const { form, mode, session, busy } = state;
  const canSubmit =
    !!mode &&
    (mode.type !== "browser-session" ||
      (!!session && session !== "checking" && session.authenticated));
  return (
    <div className="account-setup">
      <h3>添加账号</h3>
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          void state.authorize();
        }}
      >
        <fieldset disabled={busy} className="account-form-fields">
          <label className="source-field">
            <span>平台</span>
            <AnimatedSelect
              label="选择平台"
              value={form.source}
              options={adapters.map((adapter) => ({
                value: adapter.metadata.id,
                label: (
                  <OJName source={adapter.metadata.id}>
                    {adapter.metadata.displayName}
                  </OJName>
                ),
              }))}
              onChange={state.selectSource}
            />
          </label>
          {!mode && (
            <div className="unavailable-panel">
              <strong>该 OJ 暂无可用的账号接入方式</strong>
            </div>
          )}
          {form.source === "hydroj" && (
            <div className="auth-panel public-panel">
              <label>
                <span>HydroOJ 实例地址</span>
                <input
                  value={form.origin}
                  onChange={(event) =>
                    state.updateForm({ origin: event.target.value })
                  }
                  placeholder="https://hydro.ac"
                  autoComplete="off"
                />
              </label>
            </div>
          )}
          {state.modeDefinitions.length > 1 && (
            <label className="source-field auth-mode-field">
              <span>方式</span>
              <AnimatedSelect
                label="选择方式"
                value={form.authMode!}
                options={state.modeDefinitions.map((item) => ({
                  value: item.type,
                  label: item.label ?? modeLabel(item.type),
                }))}
                onChange={(authMode) =>
                  state.updateForm({
                    authMode,
                    credentials: {},
                    identifier: "",
                  })
                }
              />
            </label>
          )}
          {mode && (
            <div
              className={`auth-panel ${mode.type === "browser-session" ? "browser-panel" : "manual-panel"}`}
            >
              <div className="auth-panel-heading">
                <h4>{mode.label ?? modeLabel(mode.type)}</h4>
              </div>
              {mode.description && (
                <p className="auth-description">{mode.description}</p>
              )}
              {mode.type === "browser-session" ? (
                <div className="session-status-area">
                  <p
                    className={`session-status ${session && session !== "checking" && session.authenticated ? "is-authenticated" : "is-unauthenticated"}`}
                  >
                    {form.source === "hydroj" && !form.origin.trim()
                      ? "请输入实例地址。"
                      : sessionStatusText(session)}
                  </p>
                  {session &&
                    session !== "checking" &&
                    !session.authenticated &&
                    session.diagnostic && (
                      <p className="session-diagnostic">
                        诊断：{session.diagnostic}
                      </p>
                    )}
                  <button
                    type="button"
                    className="text-button"
                    disabled={session === "checking"}
                    onClick={() => void state.detect(true)}
                  >
                    授权并重新检测
                  </button>
                </div>
              ) : (
                <>
                  {mode.identifierRequired !== false && (
                    <label>
                      <span>{mode.identifierLabel ?? "用户名 / UID"}</span>
                      <input
                        value={form.identifier}
                        onChange={(event) =>
                          state.updateForm({ identifier: event.target.value })
                        }
                        autoComplete="off"
                      />
                    </label>
                  )}
                  {(mode.credentialFields ?? []).map((field) => (
                    <label key={field.key}>
                      <span>{field.label}</span>
                      <input
                        type={field.type ?? "password"}
                        value={form.credentials[field.key] ?? ""}
                        placeholder={field.placeholder}
                        onChange={(event) =>
                          state.updateForm({
                            credentials: {
                              ...form.credentials,
                              [field.key]: event.target.value,
                            },
                          })
                        }
                        autoComplete={
                          mode.type === "password"
                            ? field.key === "password"
                              ? "current-password"
                              : "username"
                            : "off"
                        }
                      />
                    </label>
                  ))}
                </>
              )}
              <div className="auth-panel-actions">
                <button
                  type="submit"
                  className="primary-button"
                  disabled={busy || !canSubmit}
                >
                  {state.status === "requesting-permission"
                    ? "正在申请权限…"
                    : busy
                      ? "正在验证并同步…"
                      : mode.type === "password"
                        ? "登录并添加"
                        : "添加账号"}
                </button>
              </div>
            </div>
          )}
        </fieldset>
      </form>
      {state.message && (
        <p className="message" role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}
