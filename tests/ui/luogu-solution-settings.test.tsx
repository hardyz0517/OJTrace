// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LuoguSolutionChannelSettings } from "../../entrypoints/settings/LuoguSolutionChannelSettings";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import { defaultStoredData } from "../../src/application/storage/store";
import type { PublicStoredData } from "../../src/application/accounts/account-queries";
import type { RuntimeMessage } from "../../src/application/messaging/messages";

let root: Root;
let container: HTMLDivElement;
let persisted: PublicStoredData;
const onUpdated = vi.fn();
const sendMessage = vi.fn();

function renderSettings(): void {
  root.render(
    createElement(LuoguSolutionChannelSettings, {
      preferences: persisted.preferences,
      onUpdated,
    }),
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  persisted = publicStoredData(defaultStoredData());
  onUpdated.mockImplementation(async (data: PublicStoredData) => {
    persisted = data;
  });
  sendMessage.mockImplementation(async (message: RuntimeMessage) => {
    if (message.type !== "UPDATE_LUOGU_SOLUTION_CHANNEL")
      throw new Error("Unexpected command");
    persisted = {
      ...persisted,
      revision: persisted.revision + 1,
      preferences: {
        ...persisted.preferences,
        luoguSolutionChannelEnabled: message.enabled,
      },
    };
    return {
      schemaVersion: 2,
      requestId: message.requestId,
      ok: true,
      type: "UPDATED",
      data: persisted,
    };
  });
  vi.stubGlobal("browser", { runtime: { sendMessage } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => renderSettings());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Luogu solution-channel settings", () => {
  it("is on by default and offers its enable switch in settings only", () => {
    const toggle = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(toggle?.checked).toBe(true);
    expect(container.textContent).toContain("题解通道状态标签");
    expect(container.textContent).not.toContain("授权");
    expect(
      container.querySelector(".settings-switch .sr-only")?.textContent,
    ).toContain("启用题解通道状态标签");
    expect(
      container
        .querySelector(".settings-switch-track")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("persists changes through the settings preference message", async () => {
    const toggle = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    await act(async () => toggle.click());
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_LUOGU_SOLUTION_CHANNEL",
        enabled: false,
      }),
    );
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          luoguSolutionChannelEnabled: false,
        }),
      }),
    );
  });
});
