// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrossOjSettings } from "../../entrypoints/settings/CrossOjSettings";

let root: Root;
let container: HTMLDivElement;
let granted: boolean;
const request = vi.fn<() => Promise<boolean>>();
const remove = vi.fn<() => Promise<boolean>>();
const contains = vi.fn<() => Promise<boolean>>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  granted = false;
  request.mockImplementation(async () => {
    granted = true;
    return true;
  });
  remove.mockImplementation(async () => {
    granted = false;
    return true;
  });
  contains.mockImplementation(async () => granted);
  vi.stubGlobal("browser", { permissions: { request, remove, contains } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    root.render(createElement(CrossOjSettings));
    await Promise.resolve();
  });
}

describe("cross-OJ settings", () => {
  it("requests and revokes Cloudflare access from the settings switch", async () => {
    await settle();
    const toggle = container.querySelector<HTMLInputElement>(
      ".settings-switch input",
    )!;
    expect(toggle.checked).toBe(false);

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });
    expect(toggle.checked).toBe(true);
    expect(request).toHaveBeenCalledWith({
      origins: ["https://challenges.cloudflare.com/*"],
    });

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });
    expect(toggle.checked).toBe(false);
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://challenges.cloudflare.com/*"],
    });
  });

  it("keeps the switch disabled until the existing permission state is read", async () => {
    let resolvePermission: (value: boolean) => void = () => undefined;
    contains.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePermission = resolve;
        }),
    );
    await act(async () => root.render(createElement(CrossOjSettings)));
    const toggle = container.querySelector<HTMLInputElement>(
      ".settings-switch input",
    )!;
    expect(toggle.disabled).toBe(true);
    await act(async () => resolvePermission(true));
    expect(toggle.disabled).toBe(false);
    expect(toggle.checked).toBe(true);
  });
});
