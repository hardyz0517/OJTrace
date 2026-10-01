import { createBrowserHttpClient } from "../src/platform/network/browser-http-client";
import { createStoragePort } from "../src/application/storage/store";
import { syncEnabledAccounts } from "../src/application/sync/sync-service";
import { adapterBySource } from "../src/adapters";
import { mergeSubmissions } from "../src/domain/merge";
import { AdapterFailure } from "../src/domain/errors";
import type { AccountConfig, AccountAuthMode } from "../src/domain";
import {
  isRuntimeMessage,
  isSchemaVersionSupported,
  type RuntimeMessage,
  type RuntimeResponse,
} from "../src/application/messaging/messages";
import {
  ensureSourcePermission,
  ensureAdapterDataPermission,
  hasSourcePermission,
  hasExactOriginPermission,
  requestExactOriginPermission,
  requestSourcePermission,
} from "../src/platform/permissions/hosts";
import { createHydroOJInstance } from "../src/adapters/hydroj/instance";

const TIMELINE_URL = () => browser.runtime.getURL("/timeline.html");
const storage = createStoragePort(browser.storage.local);
const http = createBrowserHttpClient();

function responseError(requestId: string, message: string): RuntimeResponse {
  return {
    schemaVersion: 1,
    requestId,
    ok: false,
    error: { code: "invalid_request", message },
  };
}

function requestIdOf(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "unknown";
  const requestId = (raw as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : "unknown";
}

async function openOrFocusTimeline(): Promise<void> {
  const url = TIMELINE_URL();
  const tabs = await browser.tabs.query({ url });
  const existing = tabs.find((tab) => typeof tab.id === "number");
  if (existing?.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await browser.tabs.create({ url });
}

function adapterErrorMessage(error: AdapterFailure): string {
  const messages: Record<string, string> = {
    "source.authRequired": "未检测到登录状态，请先登录后重新检测。",
    "source.cookieMissing":
      "未读取到洛谷登录 Cookie，请确认已登录洛谷并授予 Cookie 权限。",
    "source.httpError": "站点暂时拒绝了请求，请稍后重试。",
    "source.blocked": "站点暂时阻止了扩展请求，请稍后重试。",
    "source.rateLimited": "请求过于频繁，请稍后再试。",
    "source.invalidResponse": "站点返回格式发生变化，暂时无法读取提交记录。",
    "source.invalidRecord": "提交记录缺少必要字段。",
    "source.networkError":
      "暂时无法连接 AtCoder 提交数据服务，请检查网络后重试。",
    "source.timeout": "站点请求超时，请稍后重试。",
    "account.cookieRequired": "请输入 Cookie。",
    "account.identifierRequired": "请输入 UID / 用户名。",
    "account.identityFromCookieRequired":
      "无法从登录 Cookie 识别账号，请确认 Cookie 有效。",
    "account.authModeUnsupported": "该账号接入方式暂不可用。",
    "account.loginCredentialsRequired": "请输入 HydroOJ 用户名和密码。",
    "source.loginFailed": "HydroOJ 用户名或密码错误，或登录被站点拒绝。",
  };
  return messages[error.error.messageKey] ?? "暂时无法完成授权，请稍后重试。";
}

async function authorizeAccount(input: {
  requestId: string;
  source: AccountConfig["source"];
  authMode: AccountAuthMode;
  identifier?: string;
  credentials?: Record<string, string>;
  cookie?: string;
  origin?: string;
  permissionsGranted?: boolean;
}): Promise<RuntimeResponse> {
  const adapter = adapterBySource.get(input.source);
  if (!adapter)
    return responseError(input.requestId, "该 OJ 暂不支持账号接入。");
  if (
    !adapter.metadata.authModes.some((mode) => mode.type === input.authMode)
  ) {
    return responseError(input.requestId, "该 OJ 暂无可用的账号接入方式。");
  }
  const modeDefinition = adapter.metadata.authModes.find(
    (mode) => mode.type === input.authMode,
  );
  if (
    (input.authMode === "manual-cookie" || input.authMode === "password") &&
    modeDefinition?.identifierRequired !== false &&
    !input.identifier?.trim()
  ) {
    return responseError(input.requestId, "请输入 UID / 用户名。");
  }
  let origin: string | undefined;
  if (input.source === "hydroj") {
    try {
      origin = createHydroOJInstance(input.origin).origin;
    } catch {
      return responseError(
        input.requestId,
        "HydroOJ 实例地址无效。请输入完整根地址。",
      );
    }
  }
  const hasPermission = input.permissionsGranted
    ? true
    : origin
      ? await hasExactOriginPermission(origin)
      : input.authMode === "manual-cookie"
        ? await ensureSourcePermission(input.source)
        : true;
  if (!hasPermission && input.authMode !== "public-handle") {
    return responseError(
      input.requestId,
      "未授予该 OJ 站点权限，无法读取登录态。",
    );
  }
  if (input.authMode !== "public-handle") {
    const requiredDataOrigins =
      input.source === "atcoder" && input.authMode === "manual-cookie"
        ? ["https://kenkoooo.com/*", "https://atcoder.jp/*"]
        : undefined;
    const hasDataPermission =
      input.permissionsGranted ||
      (await ensureAdapterDataPermission(input.source, {
        // The source permission was requested separately above. Keeping this
        // request focused makes the browser permission prompt predictable and
        // lets public data origins be granted without re-requesting the site.
        includeSource: false,
        origins: requiredDataOrigins,
      }));
    if (!hasDataPermission) {
      return responseError(
        input.requestId,
        "未授予该 OJ 数据站点权限，无法获取提交记录。",
      );
    }
  }

  const account: AccountConfig = {
    accountId: crypto.randomUUID(),
    source: input.source,
    identifier: input.identifier?.trim() ?? "",
    enabled: input.authMode === "public-handle" ? hasPermission : true,
    authMode: input.authMode,
    ...((input.authMode === "manual-cookie" || input.authMode === "password") &&
    input.credentials
      ? { credentials: input.credentials }
      : {}),
    ...(input.authMode === "manual-cookie" && input.cookie
      ? { cookie: input.cookie }
      : {}),
    ...(origin ? { origin } : {}),
  };
  const now = Date.now();
  let result:
    | Awaited<ReturnType<NonNullable<(typeof adapter)["fetchRecent"]>>>
    | undefined;
  if (input.authMode !== "public-handle") {
    try {
      result = await adapter.fetchRecent({
        account,
        limit: 100,
        signal: new AbortController().signal,
        now,
        requestId: input.requestId,
        http,
      });
    } catch (error) {
      if (error instanceof AdapterFailure) {
        return responseError(input.requestId, adapterErrorMessage(error));
      }
      throw error;
    }
  }

  const data = await storage.update((current) => {
    const verifiedAccount: AccountConfig = {
      ...account,
      ...(result
        ? {
            identifier: account.identifier || result.account.providerAccountKey,
            providerAccountKey: result.account.providerAccountKey,
            providerDisplayName: result.account.displayName,
            verifiedAt: now,
          }
        : {
            providerAccountKey: account.identifier,
            providerDisplayName: account.identifier,
            verifiedAt: now,
          }),
    };
    const syncStates = { ...current.syncStates };
    if (result) {
      syncStates[account.accountId] = {
        stale: false,
        lastAttemptAt: now,
        lastSuccessAt: now,
      };
    }
    return {
      ...current,
      accounts: [...current.accounts, verifiedAccount],
      submissions: result
        ? mergeSubmissions(
            current.submissions,
            result.records,
            current.preferences.retentionPerAccount,
          )
        : current.submissions,
      syncStates,
    };
  });
  const savedAccount = data.accounts.find(
    (item) => item.accountId === account.accountId,
  )!;
  return {
    schemaVersion: 1,
    requestId: input.requestId,
    ok: true,
    type: "AUTHORIZED",
    data,
    account: savedAccount,
  };
}

export default defineBackground(() => {
  browser.action.onClicked.addListener(() => {
    void openOrFocusTimeline();
  });

  browser.runtime.onMessage.addListener((raw: unknown, sender) => {
    if (sender.id !== browser.runtime.id) return undefined;
    const schemaVersion =
      raw && typeof raw === "object"
        ? (raw as { schemaVersion?: unknown }).schemaVersion
        : undefined;
    if (!isSchemaVersionSupported(schemaVersion)) {
      return responseError(
        requestIdOf(raw),
        "Unsupported message schema version",
      );
    }
    if (!isRuntimeMessage(raw)) {
      return responseError(requestIdOf(raw), "Invalid runtime message");
    }
    const message = raw as RuntimeMessage;
    return handleMessage(message);
  });
});

async function handleMessage(
  message: RuntimeMessage,
): Promise<RuntimeResponse> {
  try {
    switch (message.type) {
      case "GET_STATE":
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "STATE",
          data: await storage.load(),
        };
      case "SYNC_REQUEST": {
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "SYNC_RESULT",
          result: await syncEnabledAccounts(storage, http, {
            force: message.force,
            accountIds: message.accountIds,
          }),
        };
      }
      case "UPDATE_SYNC_ACCOUNTS": {
        const data = await storage.update((current) => ({
          ...current,
          preferences: {
            ...current.preferences,
            syncAccountIds: [
              ...new Set(
                message.accountIds.filter((accountId) =>
                  current.accounts.some(
                    (account) => account.accountId === accountId,
                  ),
                ),
              ),
            ],
          },
        }));
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data,
        };
      }
      case "UPDATE_ACCOUNT": {
        const data = await storage.update((current) => ({
          ...current,
          accounts: [
            ...current.accounts.filter(
              (account) => account.accountId !== message.account.accountId,
            ),
            message.account,
          ],
        }));
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data,
        };
      }
      case "DELETE_ACCOUNT": {
        const data = await storage.update((current) => ({
          ...current,
          accounts: current.accounts.filter(
            (account) => account.accountId !== message.accountId,
          ),
          submissions: current.submissions.filter(
            (item) => item.accountId !== message.accountId,
          ),
          syncStates: Object.fromEntries(
            Object.entries(current.syncStates).filter(
              ([id]) => id !== message.accountId,
            ),
          ),
          preferences: {
            ...current.preferences,
            ...(current.preferences.syncAccountIds
              ? {
                  syncAccountIds: current.preferences.syncAccountIds.filter(
                    (id) => id !== message.accountId,
                  ),
                }
              : {}),
          },
        }));
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data,
        };
      }
      case "CLEAR_DATA":
        await storage.clear();
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "CLEARED",
        };
      case "CLEAR_ACCOUNTS": {
        const data = await storage.update((current) => {
          const preferences = { ...current.preferences };
          delete preferences.syncAccountIds;
          return {
            ...current,
            accounts: [],
            submissions: [],
            syncStates: {},
            preferences,
          };
        });
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data,
        };
      }
      case "CLEAR_SUBMISSIONS": {
        const data = await storage.update((current) => ({
          ...current,
          submissions: [],
        }));
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data,
        };
      }
      case "REQUEST_HOST_PERMISSION":
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "PERMISSION",
          granted: await requestSourcePermission(message.source),
        };
      case "DETECT_BROWSER_SESSION": {
        const adapter = adapterBySource.get(message.source);
        if (!adapter?.detectBrowserSession) {
          return {
            schemaVersion: 1,
            requestId: message.requestId,
            ok: true,
            type: "BROWSER_SESSION",
            source: message.source,
            account: { authenticated: false, status: "unsupported" },
          };
        }
        let sessionOrigin: string | undefined;
        if (message.source === "hydroj") {
          try {
            sessionOrigin = createHydroOJInstance(message.origin).origin;
          } catch {
            return responseError(message.requestId, "HydroOJ 实例地址无效。");
          }
        }
        if (
          !(sessionOrigin
            ? await hasExactOriginPermission(sessionOrigin)
            : message.source === "atcoder"
              ? await hasSourcePermission(message.source)
              : await ensureSourcePermission(message.source))
        ) {
          console.info("[OJTrace] QOJ permission check failed", {
            granted: false,
          });
          console.info("[OJTrace] QOJ host permission denied", {
            source: message.source,
          });
          return {
            schemaVersion: 1,
            requestId: message.requestId,
            ok: true,
            type: "BROWSER_SESSION",
            source: message.source,
            account: { authenticated: false, status: "permission-denied" },
          };
        }
        console.info("[OJTrace] QOJ permission granted", { granted: true });
        const account = await adapter.detectBrowserSession({
          signal: new AbortController().signal,
          requestId: message.requestId,
          http,
          origin: sessionOrigin,
        });
        console.info("[OJTrace] browser session result", {
          source: message.source,
          status: account.status,
          authenticated: account.authenticated,
          diagnostic: account.diagnostic,
        });
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "BROWSER_SESSION",
          source: message.source,
          account,
        };
      }
      case "AUTHORIZE_ACCOUNT":
        return authorizeAccount(message);
    }
    return responseError("unknown", "Unsupported runtime message");
  } catch (error) {
    return responseError(
      message.requestId,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}
