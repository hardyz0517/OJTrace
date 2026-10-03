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
        credentials: { username: "tester", password: " password with spaces " },
      }),
    );
    await act(async () => {
      release(authorized);
      await Promise.all([first, second]);
    });
    expect(state.form.credentials).toEqual({});
    expect(state.form.origin).toBe("");
    expect(onAuthorized).toHaveBeenCalledTimes(1);
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
