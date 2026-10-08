// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountForm } from "../../entrypoints/settings/AccountForm";
import { useAccountAuthorization } from "../../entrypoints/settings/useAccountAuthorization";
import { codeforcesAdapter } from "../../src/adapters/codeforces";

vi.mock("../../entrypoints/settings/useAccountAuthorization", () => ({
  useAccountAuthorization: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Codeforces login detection UI", () => {
  it("shows the challenge explanation and diagnostic when browser detection is blocked", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const mode = codeforcesAdapter.metadata.authModes[0]!;
    vi.mocked(useAccountAuthorization).mockReturnValue({
      form: {
        source: "codeforces",
        authMode: "browser-session",
        identifier: "",
        origin: "",
        label: "",
        credentials: {},
      },
      mode,
      modeDefinitions: codeforcesAdapter.metadata.authModes,
      status: "idle",
      busy: false,
      message: null,
      session: {
        authenticated: false,
        status: "site-error",
        diagnostic:
          "codeforces-session; http=403; codeforces-cloudflare-challenge; requestId=test",
      },
      updateForm: vi.fn(),
      selectSource: vi.fn(),
      detect: vi.fn(),
      authorize: vi.fn(),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(createElement(AccountForm, { onAuthorized: vi.fn() })),
      );
      expect(container.textContent).toContain("Cloudflare 验证拦截了后台请求");
      expect(container.textContent).toContain("直接输入用户名");
      expect(
        container.querySelector(".session-diagnostic")?.textContent,
      ).toContain("http=403");
      expect(
        container.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
