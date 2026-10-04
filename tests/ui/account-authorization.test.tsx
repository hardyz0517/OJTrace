// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountAuthorization } from "../../entrypoints/settings/useAccountAuthorization";
import { ensureAuthorizationPermission } from "../../src/platform/permissions/hosts";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import { defaultStoredData } from "../../src/application/storage/store";
import { accountRecord } from "../account-fixture";
vi.mock("../../src/platform/permissions/hosts", () => ({
  ensureAuthorizationPermission: vi.fn(async () => true),
}));
let state!: ReturnType<typeof useAccountAuthorization>;
let root: Root;
const onAuthorized = vi.fn();
function Probe() {
  state = useAccountAuthorization(onAuthorized);
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("browser", { runtime: { sendMessage: vi.fn() } });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("account authorization UI", () => {
  it("splits a domain URL for detection and authorization while requesting origin-only permission", async () => {
    const account = accountRecord({
      source: "hydroj",
      accountId: "student",
      origin: "http://ui.example.org",
      domainId: "student",
      providerAccountKey: "42",
      authMode: "browser-session",
      enabled: true,
    });
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (raw) => {
      const message = raw as unknown as { type: string };
      return message.type === "DETECT_BROWSER_SESSION"
        ? {
            ok: true,
            type: "BROWSER_SESSION",
            account: {
              authenticated: true,
              status: "authenticated",
              uid: "42",
              username: "tester",
            },
          }
        : {
            ok: true,
            type: "AUTHORIZED",
            account,
            data: publicStoredData({
              ...defaultStoredData(),
              accounts: [account],
            }),
            diagnostics: [],
            superseded: false,
          };
    });
    await act(async () => state.selectSource("hydroj"));
    await act(async () =>
      state.updateForm({ origin: "http://ui.example.org/d/student/" }),
    );
    await act(async () => state.detect(true));
    expect(ensureAuthorizationPermission).toHaveBeenCalledWith(
      "hydroj",
      "http://ui.example.org",
      true,
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DETECT_BROWSER_SESSION",
        origin: "http://ui.example.org",
        domainId: "student",
      }),
    );
    await act(async () => state.authorize());
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "AUTHORIZE_ACCOUNT",
        origin: "http://ui.example.org",
        domainId: "student",
      }),
    );
    expect(state.status).toBe("completed");
  });
  it("reports saved records with unverified completeness without claiming records were lost", async () => {
    const account = accountRecord({
      source: "atcoder",
      accountId: "a",
      providerAccountKey: "Hardy_Zheng",
      authMode: "manual-cookie",
      enabled: true,
    });
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      schemaVersion: 2,
      requestId: "r",
      ok: true,
      type: "AUTHORIZED",
      account,
      data: publicStoredData({ ...defaultStoredData(), accounts: [account] }),
      diagnostics: [],
      superseded: false,
      coverage: {
        window: { since: 0, until: 10 },
        pagesFetched: 1,
        acceptedRecords: 3,
        outcome: { status: "partial", reasons: ["unverified-coverage"] },
      },
    } as never);
    await act(async () => state.selectSource("atcoder"));
    await act(async () =>
      state.updateForm({
        authMode: "manual-cookie",
        credentials: { REVEL_SESSION: "session" },
      }),
    );
    await act(async () => state.authorize());
    expect(state.status).toBe("completed");
    expect(state.message).toBe(
      "账号已连接，已获取 3 条记录；所选范围的完整性尚未验证。",
    );
    expect(onAuthorized).toHaveBeenCalledOnce();
  });
  it("keeps a background failure code and message in the session state", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      schemaVersion: 2,
      requestId: "failed-detection",
      ok: false,
      error: { code: "permission_required", message: "站点权限查询失败。" },
    } as never);
    await act(async () => state.selectSource("qoj"));
    await act(async () => state.detect(false));
    expect(state.session).toMatchObject({
      authenticated: false,
      diagnostic:
        "background-response-error; code=permission_required; requestId=failed-detection",
    });
    expect(state.message).toBe("站点权限查询失败。");
  });

  it("blocks double submit and clears credentials after success", async () => {
    const account = accountRecord({
      source: "hydroj",
      accountId: "a",
      origin: "https://ui.example.org",
      providerAccountKey: "42",
      authMode: "password",
      enabled: true,
    });
    const authorized = {
      schemaVersion: 2,
      ok: true,
      type: "AUTHORIZED",
      requestId: "r",
      account,
      data: publicStoredData({ ...defaultStoredData(), accounts: [account] }),
      diagnostics: [],
      superseded: false,
    };
    let release!: (value: unknown) => void;
    const pending = new Promise((done) => {
      release = done;
    });
    vi.mocked(browser.runtime.sendMessage).mockReturnValue(pending as never);
    await act(async () => state.selectSource("hydroj"));
    await act(async () =>
      state.updateForm({
        authMode: "password",
        origin: "https://ui.example.org",
        label: "  School OJ  ",
        credentials: { username: "tester", password: " password with spaces " },
      }),
    );
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = state.authorize();
      second = state.authorize();
      await Promise.resolve();
    });
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "School OJ",
        credentials: { username: "tester", password: " password with spaces " },
      }),
    );
    await act(async () => {
      release(authorized);
      await Promise.all([first, second]);
    });
    expect(state.form.credentials).toEqual({});
    expect(state.form.origin).toBe("");
    expect(state.form.label).toBe("");
    expect(onAuthorized).toHaveBeenCalledTimes(1);
  });
  it("keeps an in-flight browser session detection when the instance name changes", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.mocked(browser.runtime.sendMessage).mockReturnValue(pending as never);
    await act(async () => state.selectSource("hydroj"));
    await act(async () =>
      state.updateForm({ origin: "https://ui.example.org" }),
    );
    let detection!: Promise<void>;
    await act(async () => {
      detection = state.detect(false);
    });
    await act(async () => state.updateForm({ label: "School OJ" }));
    await act(async () => {
      release({
        schemaVersion: 2,
        requestId: "r",
        ok: true,
        type: "BROWSER_SESSION",
        source: "hydroj",
        account: {
          authenticated: true,
          status: "authenticated",
          username: "tester",
        },
      });
      await detection;
    });
    expect(state.session).toMatchObject({
      authenticated: true,
      username: "tester",
    });
    expect(state.form.label).toBe("School OJ");
  });
  it("rejects an invalid instance before requesting permission or sending a command", async () => {
    await act(async () => state.selectSource("hydroj"));
    await act(async () =>
      state.updateForm({
        authMode: "password",
        origin: "https://ui.example.org/path",
        credentials: { username: "tester", password: "fake" },
      }),
    );
    await act(async () => state.authorize());
    expect(ensureAuthorizationPermission).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    expect(state.status).toBe("failed");
  });
});
