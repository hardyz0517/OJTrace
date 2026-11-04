import type { CrossOjSubmissionRecord } from "./model";
import { readCrossOjHistory } from "./history";

// Chrome's scripting API accepts extension-root-relative paths. WXT's
// generated PublicPath currently requires a leading slash for this field.
const LUOGU_SCRIPT_EXECUTION_PATH =
  "content-scripts/luogu-cross-oj.js" as unknown as `/content-scripts/luogu-cross-oj.js`;

export class CrossOjClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CrossOjClientError";
  }
}

export async function requestCrossOjPermissions(
  target: "codeforces" | "atcoder",
): Promise<boolean> {
  try {
    return await browser.permissions.request({
      origins: [
        target === "codeforces"
          ? "https://codeforces.com/*"
          : "https://atcoder.jp/*",
      ],
    });
  } catch {
    return false;
  }
}

export async function hasCrossOjPermissions(
  target: "codeforces" | "atcoder",
): Promise<boolean> {
  try {
    return await browser.permissions.contains({
      origins: [
        "https://www.luogu.com.cn/*",
        target === "codeforces"
          ? "https://codeforces.com/*"
          : "https://atcoder.jp/*",
      ],
    });
  } catch {
    return false;
  }
}

export async function enableLuoguPageIntegration(input: {
  tabId: number;
  url: string;
  target: "codeforces" | "atcoder";
}): Promise<void> {
  const permissionRequest = requestCrossOjPermissions(input.target);
  if (!(await permissionRequest))
    throw new CrossOjClientError(
      "permission-denied",
      "需要授予洛谷和目标 OJ 的站点权限，才能在洛谷页面显示按钮。",
    );
  const tab = await browser.tabs.get(input.tabId);
  if (
    tab.url !== input.url ||
    new URL(input.url).origin !== "https://www.luogu.com.cn"
  )
    throw new CrossOjClientError("tab-changed", "洛谷页面已变化，请重试。");
  const id = "ojtrace-luogu-cross-oj";
  const existing = await browser.scripting.getRegisteredContentScripts();
  if (!existing.some((script) => script.id === id)) {
    await browser.scripting.registerContentScripts([
      {
        id,
        matches: ["https://www.luogu.com.cn/*"],
        js: ["content-scripts/luogu-cross-oj.js"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
  }
  await browser.scripting.executeScript({
    target: { tabId: input.tabId },
    files: [LUOGU_SCRIPT_EXECUTION_PATH],
  });
}

export async function currentActiveTab(): Promise<{
  tabId: number;
  url: string;
}> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find((item) => typeof item.id === "number");
  if (typeof tab?.id !== "number" || !tab.url)
    throw new CrossOjClientError("no-active-tab", "当前没有可用的活动标签页。");
  return { tabId: tab.id, url: tab.url };
}

export async function loadCrossOjHistory(): Promise<CrossOjSubmissionRecord[]> {
  try {
    const requestId = crypto.randomUUID();
    const response: unknown = await browser.runtime.sendMessage({
      schemaVersion: 1,
      requestId,
      type: "GET_CROSS_OJ_HISTORY",
    });
    if (
      !response ||
      typeof response !== "object" ||
      (response as { requestId?: unknown }).requestId !== requestId ||
      (response as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      (response as { ok?: unknown }).ok !== true
    )
      return [];
    return readCrossOjHistory((response as { history?: unknown }).history);
  } catch {
    return [];
  }
}
