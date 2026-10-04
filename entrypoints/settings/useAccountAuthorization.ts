import { useEffect, useRef, useState } from "react";
import { adapterBySource } from "../../src/adapters";
import { createHydroOJInstance } from "../../src/adapters/hydroj/instance";
import type {
  AccountAuthMode,
  BrowserSessionAccount,
  SourceId,
} from "../../src/domain";
import type { RuntimeResponse } from "../../src/application/messaging/messages";
import { ensureAuthorizationPermission } from "../../src/platform/permissions/hosts";

export type AuthorizedResponse = Extract<
  RuntimeResponse,
  { type: "AUTHORIZED" }
>;
type Status =
  | "idle"
  | "validating-input"
  | "requesting-permission"
  | "authorizing"
  | "completed"
  | "failed";
type Session = "checking" | BrowserSessionAccount | null;
export interface AccountFormValue {
  source: SourceId;
  authMode: AccountAuthMode | null;
  identifier: string;
  label: string;
  origin: string;
  credentials: Record<string, string>;
}

function initialForm(source: SourceId): AccountFormValue {
  const modes = adapterBySource.get(source)?.metadata.authModes ?? [];
  return {
    source,
    authMode:
      modes.find((mode) => mode.recommended)?.type ?? modes[0]?.type ?? null,
    identifier: "",
    label: "",
    origin: "",
    credentials: {},
  };
}

function normalizedScope(form: AccountFormValue): {
  origin?: string;
  domainId?: string;
} {
  if (form.source !== "hydroj") return {};
  if (!form.origin.trim()) throw new Error("请输入 HydroOJ 实例地址。");
  try {
    const { origin, domainId } = createHydroOJInstance(form.origin.trim());
    return { origin, ...(domainId === undefined ? {} : { domainId }) };
  } catch {
    throw new Error("实例地址无效，请输入网站根地址或 /d/域名/ 地址。");
  }
}

function send(message: object): Promise<RuntimeResponse> {
  return browser.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}

export function useAccountAuthorization(
  onAuthorized: (response: AuthorizedResponse) => void,
) {
  const [form, setForm] = useState(() => initialForm("codeforces"));
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<Session>(null);
  const busyRef = useRef(false);
  const detectionRevision = useRef(0);
  const busy =
    status === "validating-input" ||
    status === "requesting-permission" ||
    status === "authorizing";
  const modeDefinitions =
    adapterBySource.get(form.source)?.metadata.authModes ?? [];
  const mode = modeDefinitions.find((item) => item.type === form.authMode);

  function updateForm(patch: Partial<AccountFormValue>) {
    if (busyRef.current) return;
    if (Object.keys(patch).some((key) => key !== "label"))
      detectionRevision.current += 1;
    setForm((current) => ({ ...current, ...patch }));
    setMessage(null);
    setStatus("idle");
  }

  function selectSource(source: SourceId) {
    if (busyRef.current) return;
    detectionRevision.current += 1;
    setForm(initialForm(source));
    setSession(null);
    setMessage(null);
    setStatus("idle");
  }

  async function detect(requestPermission: boolean) {
    const revision = ++detectionRevision.current;
    setSession("checking");
    try {
      const scope = normalizedScope(form);
      const { origin } = scope;
      if (
        requestPermission &&
        !(await ensureAuthorizationPermission(form.source, origin, true))
      ) {
        if (revision === detectionRevision.current)
          setSession({
            authenticated: false,
            status: "permission-denied",
            diagnostic: `host-permission-denied; source=${form.source}`,
          });
        return;
      }
      const response = await send({
        schemaVersion: 2,
        type: "DETECT_BROWSER_SESSION",
        requestId: crypto.randomUUID(),
        source: form.source,
        ...scope,
      });
      if (revision !== detectionRevision.current) return;
      if (!response.ok) {
        setSession({
          authenticated: false,
          status: "site-error",
          diagnostic: `background-response-error; code=${response.error.code}; requestId=${response.requestId}`,
        });
        setMessage(response.error.message);
      } else if (response.type === "BROWSER_SESSION") {
        setSession(response.account);
      } else {
        setSession({
          authenticated: false,
          status: "site-error",
          diagnostic: `background-response-invalid; type=${response.type}; requestId=${response.requestId}`,
        });
      }
    } catch (error) {
      if (revision !== detectionRevision.current) return;
      setSession({
        authenticated: false,
        status: "site-error",
        diagnostic: `detect-request-error: ${error instanceof Error ? error.message : "unknown"}`,
      });
      setMessage(
        error instanceof Error ? error.message : "暂时无法检测登录状态。",
      );
    }
  }

  useEffect(() => {
    detectionRevision.current += 1;
    if (
      form.authMode !== "browser-session" ||
      (form.source === "hydroj" && !form.origin.trim())
    ) {
      setSession(null);
      return;
    }
    setSession("checking");
    const timer = window.setTimeout(() => void detect(false), 350);
    return () => {
      window.clearTimeout(timer);
      detectionRevision.current += 1;
    };
  }, [form.source, form.authMode, form.origin]);

  async function authorize() {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus("validating-input");
    setMessage(null);
    try {
      if (!mode) throw new Error("该 OJ 暂无可用的账号接入方式。");
      const scope = normalizedScope(form);
      const { origin } = scope;
      const identifier = form.identifier.trim();
      if (
        mode.type === "browser-session" &&
        (!session || session === "checking" || !session.authenticated)
      )
        throw new Error("请先授权站点并检测登录状态。");
      if (
        mode.type !== "browser-session" &&
        mode.identifierRequired !== false &&
        !identifier
      )
        throw new Error("请填写账号标识。");
      const credentials = Object.fromEntries(
        (mode.credentialFields ?? []).flatMap((field) => {
          const value =
            field.key === "password"
              ? (form.credentials[field.key] ?? "")
              : (form.credentials[field.key]?.trim() ?? "");
          if (field.required !== false && !value)
            throw new Error("请填写全部必需凭证。");
          return value ? [[field.key, value]] : [];
        }),
      );
      setStatus("requesting-permission");
      if (!(await ensureAuthorizationPermission(form.source, origin, true)))
        throw new Error("未授予站点权限，请重新授权。");
      setStatus("authorizing");
      const response = await send({
        schemaVersion: 2,
        type: "AUTHORIZE_ACCOUNT",
        requestId: crypto.randomUUID(),
        source: form.source,
        authMode: mode.type,
        ...(identifier ? { identifier } : {}),
        ...(form.source === "hydroj" && form.label.trim()
          ? { label: form.label.trim() }
          : {}),
        ...scope,
        ...(Object.keys(credentials).length ? { credentials } : {}),
      });
      if (!response.ok) throw new Error(response.error.message);
      if (response.type !== "AUTHORIZED")
        throw new Error("授权响应格式错误，请重试。");
      setForm((current) => ({
        ...current,
        identifier: "",
        label: "",
        origin: "",
        credentials: {},
      }));
      setStatus("completed");
      setMessage(
        response.superseded
          ? "账号已被另一项操作更新或删除，请刷新后重试。"
          : response.syncError
            ? "账号已连接；首次同步失败，可稍后在时间线重试。"
            : response.coverage?.outcome.status === "complete"
              ? "账号已连接并完成首次同步。"
              : response.coverage?.outcome.status === "partial"
                ? response.coverage.outcome.reasons.length === 1 &&
                  response.coverage.outcome.reasons[0] === "unverified-coverage"
                  ? `账号已连接，已获取 ${response.coverage.acceptedRecords} 条记录；所选范围的完整性尚未验证。`
                  : "账号已连接，首次同步未完整完成，请查看提示。"
                : "账号已连接，首次同步覆盖状态未知，请查看提示。",
      );
      onAuthorized(response);
    } catch (error) {
      setStatus("failed");
      setMessage(
        error instanceof Error ? error.message : "操作失败，请稍后重试。",
      );
    } finally {
      busyRef.current = false;
    }
  }

  return {
    form,
    mode,
    modeDefinitions,
    status,
    busy,
    message,
    session,
    updateForm,
    selectSource,
    detect,
    authorize,
  };
}
