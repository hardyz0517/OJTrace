import { createHttpClient } from "../src/platform/network/http-client";
import { createStoragePort } from "../src/application/storage/store";
import { syncEnabledAccounts } from "../src/application/sync/sync-service";
import {
  isRuntimeMessage,
  type RuntimeMessage,
  type RuntimeResponse,
} from "../src/application/messaging/messages";
import { requestSourcePermission } from "../src/platform/permissions/hosts";

const TIMELINE_URL = () => browser.runtime.getURL("/timeline.html");
const storage = createStoragePort(browser.storage.local);
const http = createHttpClient();

function responseError(requestId: string, message: string): RuntimeResponse {
  return {
    schemaVersion: 1,
    requestId,
    ok: false,
    error: { code: "invalid_request", message },
  };
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

export default defineBackground(() => {
  browser.action.onClicked.addListener(() => {
    void openOrFocusTimeline();
  });

  browser.runtime.onMessage.addListener((raw: unknown, sender) => {
    if (sender.id !== browser.runtime.id || !isRuntimeMessage(raw))
      return undefined;
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
      case "SYNC_REQUEST":
        return {
          schemaVersion: 1,
          requestId: message.requestId,
          ok: true,
          type: "SYNC_RESULT",
          result: await syncEnabledAccounts(storage, http, {
            force: message.force,
          }),
        };
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
    }
  } catch (error) {
    return responseError(
      message.requestId,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}
