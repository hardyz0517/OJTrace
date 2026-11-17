import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enableLuoguPageIntegration,
  hasCrossOjPermissions,
  hasCloudflareChallengePermission,
  removeCloudflareChallengePermission,
  requestCrossOjPermissions,
  requestCloudflareChallengePermission,
} from "../../src/oj-enhancer/features/cross-oj-submit/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cross-OJ site permissions", () => {
  it("requests the official AtCoder site access", async () => {
    const request = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("browser", {
      permissions: {
        request,
      },
    });

    await expect(requestCrossOjPermissions("atcoder")).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({
      origins: ["https://atcoder.jp/*"],
    });
  });

  it("requires the official AtCoder permission for integration", async () => {
    const contains = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("browser", {
      permissions: {
        contains,
      },
    });

    await expect(hasCrossOjPermissions("atcoder")).resolves.toBe(true);
    expect(contains).toHaveBeenCalledWith({
      origins: ["https://www.luogu.com.cn/*", "https://atcoder.jp/*"],
    });
  });

  it("requests Cloudflare access only when its optimization is enabled", async () => {
    const request = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("browser", {
      permissions: {
        request,
        contains: vi.fn().mockResolvedValue(true),
      },
    });

    await expect(requestCloudflareChallengePermission()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({
      origins: ["https://challenges.cloudflare.com/*"],
    });
  });

  it("reports whether the optimization permission is currently granted", async () => {
    const contains = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("browser", {
      permissions: {
        contains,
      },
    });

    await expect(hasCloudflareChallengePermission()).resolves.toBe(true);
    expect(contains).toHaveBeenCalledWith({
      origins: ["https://challenges.cloudflare.com/*"],
    });
  });

  it("revokes the optional Cloudflare permission when disabled", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    const contains = vi.fn().mockResolvedValue(false);
    vi.stubGlobal("browser", { permissions: { remove, contains } });

    await expect(removeCloudflareChallengePermission()).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://challenges.cloudflare.com/*"],
    });
  });

  it("reports a failed revocation when the permission is still present", async () => {
    const remove = vi.fn().mockResolvedValue(false);
    const contains = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("browser", { permissions: { remove, contains } });

    await expect(removeCloudflareChallengePermission()).resolves.toBe(false);
    expect(contains).toHaveBeenCalledOnce();
  });
});

describe("Luogu page integration bootstrap", () => {
  const url = "https://www.luogu.com.cn/problem/P1001";

  it("injects the static scripts without registering content scripts", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const get = vi.fn().mockResolvedValue({ id: 7, url });
    const executeScript = vi.fn().mockResolvedValue([]);
    const registerContentScripts = vi.fn();
    const getRegisteredContentScripts = vi.fn();
    vi.stubGlobal("browser", {
      permissions: { request },
      tabs: { get },
      scripting: {
        executeScript,
        registerContentScripts,
        getRegisteredContentScripts,
      },
    });

    await enableLuoguPageIntegration({ tabId: 7, url, target: "atcoder" });

    expect(registerContentScripts).not.toHaveBeenCalled();
    expect(getRegisteredContentScripts).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: 7 },
      files: ["content-scripts/luogu-cross-oj.js"],
    });
  });

  it("rejects a tab that navigated away before injection", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const get = vi.fn().mockResolvedValue({
      id: 7,
      url: "https://www.luogu.com.cn/problem/P1002",
    });
    const executeScript = vi.fn();
    vi.stubGlobal("browser", {
      permissions: { request },
      tabs: { get },
      scripting: { executeScript },
    });

    await expect(
      enableLuoguPageIntegration({ tabId: 7, url, target: "codeforces" }),
    ).rejects.toThrow("洛谷页面已变化");
    expect(executeScript).not.toHaveBeenCalled();
  });
});
