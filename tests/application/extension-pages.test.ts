import { afterEach, describe, expect, it, vi } from "vitest";
import { openOrFocusSettings } from "../../src/application/navigation/extension-pages";

afterEach(() => vi.unstubAllGlobals());
describe("settings tab navigation", () => {
  it("focuses an existing section without navigating away from its in-memory drafts", async () => {
    const update = vi.fn(),
      create = vi.fn(),
      focus = vi.fn();
    vi.stubGlobal("browser", {
      runtime: { getURL: (path: string) => `chrome-extension://test${path}` },
      tabs: {
        query: vi.fn(async () => [
          { id: 1, url: "chrome-extension://test/settings.html-other" },
          {
            id: 2,
            windowId: 3,
            url: "chrome-extension://test/settings.html#cnoi",
          },
        ]),
        update,
        create,
      },
      windows: { update: focus },
    });
    await openOrFocusSettings();
    expect(update).toHaveBeenCalledWith(2, { active: true });
    expect(focus).toHaveBeenCalledWith(3, { focused: true });
    expect(create).not.toHaveBeenCalled();
  });
  it("opens the single settings entrypoint if no matching page exists", async () => {
    const create = vi.fn();
    vi.stubGlobal("browser", {
      runtime: { getURL: (path: string) => `chrome-extension://test${path}` },
      tabs: { query: vi.fn(async () => []), create },
    });
    await openOrFocusSettings();
    expect(create).toHaveBeenCalledWith({
      url: "chrome-extension://test/settings.html",
    });
  });
});
