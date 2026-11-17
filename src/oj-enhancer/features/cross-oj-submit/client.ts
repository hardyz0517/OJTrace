// Chrome's scripting API accepts extension-root-relative paths. WXT's
// generated PublicPath currently requires a leading slash for this field.
const LUOGU_SCRIPT_EXECUTION_PATH =
  "content-scripts/luogu-cross-oj.js" as unknown as `/content-scripts/luogu-cross-oj.js`;
const CLOUDFLARE_CHALLENGE_PERMISSION = "https://challenges.cloudflare.com/*";

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
    const targetPermission =
      target === "codeforces"
        ? ["https://codeforces.com/*"]
        : ["https://atcoder.jp/*"];
    return await browser.permissions.request({ origins: targetPermission });
  } catch {
    return false;
  }
}

export async function requestCloudflareChallengePermission(): Promise<boolean> {
  try {
    await browser.permissions.request({
      origins: [CLOUDFLARE_CHALLENGE_PERMISSION],
    });
    return await hasCloudflareChallengePermission();
  } catch {
    return false;
  }
}

export async function removeCloudflareChallengePermission(): Promise<boolean> {
  try {
    await browser.permissions.remove({
      origins: [CLOUDFLARE_CHALLENGE_PERMISSION],
    });
    return !(await hasCloudflareChallengePermission());
  } catch {
    return false;
  }
}

export async function hasCloudflareChallengePermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({
      origins: [CLOUDFLARE_CHALLENGE_PERMISSION],
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
      origins:
        target === "codeforces"
          ? ["https://www.luogu.com.cn/*", "https://codeforces.com/*"]
          : ["https://www.luogu.com.cn/*", "https://atcoder.jp/*"],
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
  if (!(await requestCrossOjPermissions(input.target)))
    throw new CrossOjClientError(
      "permission-denied",
      input.target === "atcoder"
        ? "需要授予洛谷和 AtCoder 的站点权限，才能在洛谷页面使用此功能。"
        : "需要授予洛谷和 Codeforces 的站点权限，才能在洛谷页面使用此功能。",
    );
  const tab = await browser.tabs.get(input.tabId);
  if (
    tab.url !== input.url ||
    new URL(input.url).origin !== "https://www.luogu.com.cn"
  )
    throw new CrossOjClientError("tab-changed", "洛谷页面已变化，请重试。");
  // Manifest-declared content scripts already run on every Luogu page. This
  // injection only bootstraps a tab opened before install or extension reload;
  // the scripts' own instance guards make it a no-op otherwise.
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
