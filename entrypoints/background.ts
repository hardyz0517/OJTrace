import { createBrowserHttpClient } from "../src/platform/network/browser-http-client";
import { createStoragePort } from "../src/application/storage/store";
import { publicStoredData } from "../src/application/accounts/account-queries";
import { AccountCommandError } from "../src/application/accounts/account-errors";
import { errorMessage } from "../src/application/messaging/error-messages";
import { createAccountService } from "../src/application/accounts/account-service";
import { syncEnabledAccounts } from "../src/application/sync/sync-service";
import { adapterBySource } from "../src/adapters";
import { AdapterFailure } from "../src/domain/errors";
import {
  isRuntimeMessage,
  isSchemaVersionSupported,
  type RuntimeMessage,
  type RuntimeResponse,
} from "../src/application/messaging/messages";
import {
  ensureAuthorizationPermission,
  hasSourcePermission,
  hasExactOriginPermission,
  requestSourcePermission,
} from "../src/platform/permissions/hosts";
import { createHydroOJInstance } from "../src/adapters/hydroj/instance";

const TIMELINE_URL = () => browser.runtime.getURL("/timeline.html");
const storage = createStoragePort(browser.storage.local);
const http = createBrowserHttpClient();
const accounts = createAccountService(storage, {
  http,
  ensurePermission: ensureAuthorizationPermission,
});

function responseError(
  requestId: string,
  message: string,
  code = "invalid_request",
): RuntimeResponse {
  return {
    schemaVersion: 2,
    requestId,
    ok: false,
    error: { code, message },
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

async function authorizeAccount(
  input: Extract<RuntimeMessage, { type: "AUTHORIZE_ACCOUNT" }>,
): Promise<RuntimeResponse> {
  const saved = await accounts.authorize(input);
  return {
    schemaVersion: 2,
    requestId: input.requestId,
    ok: true,
    type: "AUTHORIZED",
    data: publicStoredData(saved.data),
    account: saved.account,
    diagnostics: saved.diagnostics,
    superseded: saved.superseded,
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
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "STATE",
          data: publicStoredData(await storage.load()),
        };
      case "SYNC_REQUEST": {
        const result = await syncEnabledAccounts(storage, http, {
          force: message.force,
          since: message.since,
          until: message.until,
          accountIds: message.accountIds,
        });
        return {
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "SYNC_RESULT",
          result: { ...result, data: publicStoredData(result.data) },
        };
      }
      case "UPDATE_SYNC_ACCOUNTS": {
        const data = await storage.transact((current) => ({
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
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data: publicStoredData(data),
        };
      }
      case "UPDATE_SYNC_RANGE": {
        const data = await storage.transact((current) => ({
          ...current,
          preferences: {
            ...current.preferences,
            syncRange: message.range,
          },
        }));
        return {
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data: publicStoredData(data),
        };
      }
      case "DELETE_ACCOUNT": {
        const data = await accounts.remove(message.accountId);
        return {
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data: publicStoredData(data),
        };
      }
      case "CLEAR_DATA":
        await storage.clear();
        return {
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "CLEARED",
        };
      case "CLEAR_ACCOUNTS": {
        const data = await accounts.clearAll();
        return {
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data: publicStoredData(data),
        };
      }
      case "CLEAR_SUBMISSIONS": {
        const data = await storage.transact((current) => ({
          ...current,
          submissions: [],
        }));
        return {
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "UPDATED",
          data: publicStoredData(data),
        };
      }
      case "REQUEST_HOST_PERMISSION":
        return {
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "PERMISSION",
          granted: await requestSourcePermission(message.source),
        };
      case "DETECT_BROWSER_SESSION": {
        const adapter = adapterBySource.get(message.source);
        if (!adapter?.detectBrowserSession) {
          return {
            schemaVersion: 2,
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
            : await hasSourcePermission(message.source))
        ) {
          console.info("[OJTrace] host permission check failed", {
            granted: false,
            source: message.source,
          });
          console.info("[OJTrace] host permission denied", {
            source: message.source,
          });
          return {
            schemaVersion: 2,
            requestId: message.requestId,
            ok: true,
            type: "BROWSER_SESSION",
            source: message.source,
            account: {
              authenticated: false,
              status: "permission-denied",
              diagnostic: `host-permission-missing; source=${message.source}`,
            },
          };
        }
        console.info("[OJTrace] host permission granted", {
          source: message.source,
          granted: true,
        });
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
          schemaVersion: 2,
          requestId: message.requestId,
          ok: true,
          type: "BROWSER_SESSION",
          source: message.source,
          account,
        };
      }
      case "AUTHORIZE_ACCOUNT":
        return await authorizeAccount(message);
    }
    return responseError("unknown", "Unsupported runtime message");
  } catch (error) {
    if (error instanceof AdapterFailure)
      return responseError(
        message.requestId,
        errorMessage(error.error.messageKey),
        error.error.kind,
      );
    if (error instanceof AccountCommandError) {
      return responseError(
        message.requestId,
        errorMessage(error.messageKey),
        error.code,
      );
    }
    return responseError(message.requestId, "操作失败，请稍后重试。");
  }
}
