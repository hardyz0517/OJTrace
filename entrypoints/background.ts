import { createBrowserHttpClient } from "../src/platform/network/browser-http-client";
import { createStoragePort } from "../src/application/storage/store";
import {
  authorizedResponse,
  browserSessionResponse,
  clearedResponse,
  dataResponse,
  messageEnvelope,
  responseError,
  syncResultResponse,
} from "../src/application/messaging/responses";
import { AccountCommandError } from "../src/application/accounts/account-errors";
import { errorMessage } from "../src/application/messaging/error-messages";
import { createAccountService } from "../src/application/accounts/account-service";
import { syncEnabledAccounts } from "../src/application/sync/sync-service";
import { adapterRegistry } from "../src/adapters";
import { AdapterFailure } from "../src/domain/errors";
import {
  isRuntimeMessage,
  isSchemaVersionSupported,
  isSyncProgressEvent,
  type RuntimeMessage,
  type RuntimeResponse,
  type SyncProgressEvent,
} from "../src/application/messaging/messages";
import {
  ensureAuthorizationPermission,
  hasSourcePermission,
  hasExactOriginPermission,
} from "../src/platform/permissions/hosts";
import { createHydroOJInstance } from "../src/adapters/hydroj/instance";
import {
  createRateLimitRegistry,
  type RateLimitEntry,
} from "../src/platform/network/rate-limit";
import { createPaginationRuntime } from "../src/platform/network/pagination-throttle";
import { createAccountCollector } from "../src/application/sync/collect-account";
import { SyncRangeError } from "../src/domain";
import { updatePaginationPreference } from "../src/application/preferences/pagination-preferences";

const TIMELINE_URL = () => browser.runtime.getURL("/timeline.html");
const storage = createStoragePort(browser.storage.local);
const rateLimits = createRateLimitRegistry({
  storage: {
    async load() {
      return (await browser.storage.session.get("ojtrace:rateLimits"))[
        "ojtrace:rateLimits"
      ] as RateLimitEntry[] | undefined;
    },
    async save(entries) {
      await browser.storage.session.set({ "ojtrace:rateLimits": entries });
    },
  },
  onStorageError() {
    console.warn(
      "[OJTrace] rate-limit session persistence unavailable; using in-memory cooldown",
    );
  },
});
const http = createBrowserHttpClient({ rateLimits });
const pagination = createPaginationRuntime({ rateLimits });
const collector = createAccountCollector(storage, http, { pagination });
const accounts = createAccountService(storage, {
  http,
  collector,
  ensurePermission: ensureAuthorizationPermission,
});

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
  return authorizedResponse(input.requestId, saved);
}

export default defineBackground(() => {
  browser.action.onClicked.addListener(() => {
    void openOrFocusTimeline();
  });

  browser.runtime.onMessage.addListener((raw: unknown, sender) => {
    if (sender.id !== browser.runtime.id) return undefined;
    if (isSyncProgressEvent(raw)) return undefined;
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
    return handleMessage(raw);
  });
});

async function handleMessage(
  message: RuntimeMessage,
): Promise<RuntimeResponse> {
  try {
    await rateLimits.ready();
    switch (message.type) {
      case "GET_STATE":
        return dataResponse(message.requestId, "STATE", await storage.load());
      case "SYNC_REQUEST": {
        let sequence = 0;
        const result = await syncEnabledAccounts(
          storage,
          http,
          {
            force: message.force,
            recheckActivities: message.recheckActivities,
            since: message.since,
            until: message.until,
            accountIds: message.accountIds,
            onProgress(progress) {
              const event: SyncProgressEvent = {
                ...messageEnvelope(message.requestId),
                type: "SYNC_PROGRESS",
                sequence: ++sequence,
                progress,
              };
              // Pages may close while collection continues; notifications are optional.
              void browser.runtime.sendMessage(event).catch(() => {});
            },
          },
          collector,
        );
        return syncResultResponse(message.requestId, result);
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
        return dataResponse(message.requestId, "UPDATED", data);
      }
      case "UPDATE_SYNC_RANGE": {
        const data = await storage.transact((current) => ({
          ...current,
          preferences: {
            ...current.preferences,
            syncRange: message.range,
          },
        }));
        return dataResponse(message.requestId, "UPDATED", data);
      }
      case "UPDATE_PAGINATION_POLICY": {
        const data = await updatePaginationPreference(
          storage,
          message.source,
          message.policy,
        );
        return dataResponse(message.requestId, "UPDATED", data);
      }
      case "DELETE_ACCOUNT": {
        const data = await accounts.remove(message.accountId);
        return dataResponse(message.requestId, "UPDATED", data);
      }
      case "CLEAR_DATA":
        accounts.cancelPending();
        await storage.clear();
        return clearedResponse(message.requestId);
      case "CLEAR_ACCOUNTS": {
        const data = await accounts.clearAll();
        return dataResponse(message.requestId, "UPDATED", data);
      }
      case "CLEAR_SUBMISSIONS": {
        collector.cancelAll();
        const data = await storage.transact((current) => ({
          ...current,
          submissions: [],
        }));
        return dataResponse(message.requestId, "UPDATED", data);
      }
      case "DETECT_BROWSER_SESSION": {
        const adapter = adapterRegistry[message.source];
        if (!adapter?.detectBrowserSession) {
          return browserSessionResponse(message.requestId, message.source, {
            authenticated: false,
            status: "unsupported",
          });
        }
        let sessionOrigin: string | undefined;
        let sessionDomainId: string | undefined;
        if (message.source === "hydroj") {
          try {
            const instance = createHydroOJInstance(
              message.origin,
              message.domainId,
            );
            sessionOrigin = instance.origin;
            sessionDomainId = instance.domainId;
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
          return browserSessionResponse(message.requestId, message.source, {
            authenticated: false,
            status: "permission-denied",
            diagnostic: `host-permission-missing; source=${message.source}`,
          });
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
          domainId: sessionDomainId,
        });
        console.info("[OJTrace] browser session result", {
          source: message.source,
          status: account.status,
          authenticated: account.authenticated,
          diagnostic: account.diagnostic,
        });
        return browserSessionResponse(
          message.requestId,
          message.source,
          account,
        );
      }
      case "AUTHORIZE_ACCOUNT":
        return await authorizeAccount(message);
    }
    return responseError("unknown", "Unsupported runtime message");
  } catch (error) {
    if (error instanceof SyncRangeError)
      return responseError(
        message.requestId,
        errorMessage("sync.invalidRange"),
        error.code,
      );
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
