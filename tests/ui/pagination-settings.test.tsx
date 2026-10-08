// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaginationSettings } from "../../entrypoints/settings/PaginationSettings";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import { defaultStoredData } from "../../src/application/storage/store";
import type { PublicStoredData } from "../../src/application/accounts/account-queries";
import type { RuntimeMessage } from "../../src/application/messaging/messages";

let root: Root;
let container: HTMLDivElement;
let persisted: PublicStoredData;
let refresh: (data: PublicStoredData) => Promise<PublicStoredData>;
const updated = vi.fn();

function Probe() {
  const [data, setData] = useState(persisted);
  return createElement(PaginationSettings, {
    preferences: data.preferences,
    onUpdated: async (next) => {
      updated(next);
      setData(await refresh(next));
    },
  });
}

function form(source = "Codeforces"): HTMLFormElement {
  return container.querySelector<HTMLFormElement>(
    `form[aria-label="${source} 采集节奏"]`,
  )!;
}
function input(label: string, source = "Codeforces"): HTMLInputElement {
  return form(source).querySelector<HTMLInputElement>(
    `input[aria-label="${source} ${label}"]`,
  )!;
}
function button(label: string, source = "Codeforces"): HTMLButtonElement {
  return [...form(source).querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === label,
  )!;
}
async function change(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function focus(element: HTMLInputElement) {
  await act(async () => element.focus());
}
async function blur(element: HTMLInputElement) {
  await act(async () => element.blur());
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  persisted = publicStoredData(defaultStoredData());
  refresh = async (data) => data;
  vi.stubGlobal("browser", {
    runtime: {
      sendMessage: vi.fn(async (command: RuntimeMessage) => {
        if (command.type !== "UPDATE_PAGINATION_POLICY")
          throw new Error("Unexpected command");
        const paginationBySource = {
          ...persisted.preferences.paginationBySource,
        };
        if (command.policy === null) delete paginationBySource[command.source];
        else paginationBySource[command.source] = command.policy;
        persisted = {
          ...persisted,
          revision: persisted.revision + 1,
          preferences: { ...persisted.preferences, paginationBySource },
        };
        return {
          schemaVersion: 2,
          ok: true,
          type: "UPDATED",
          requestId: command.requestId,
          data: persisted,
        };
      }),
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("pagination settings UI", () => {
  it("uses fresh preferences when a save reply predates a clear-all and resets unsaved default drafts", async () => {
    refresh = async () => publicStoredData(defaultStoredData());
    await change(input("基础间隔（秒）"), "3");
    await act(async () => button("保存").click());
    expect(input("基础间隔（秒）").value).toBe("1.5");
    expect(input("随机浮动（±秒）").value).toBe("0.5");
    expect(button("保存").disabled).toBe(true);
    await change(input("基础间隔（秒）"), "4");
    await act(async () => button("恢复默认").click());
    expect(input("基础间隔（秒）").value).toBe("1.5");
    expect(button("保存").disabled).toBe(true);
  });
  it("shows all sources and the default pagination values", () => {
    expect(container.querySelectorAll("form")).toHaveLength(5);
    expect(input("基础间隔（秒）").value).toBe("1.5");
    expect(input("随机浮动（±秒）").value).toBe("0.5");
    expect(button("保存").disabled).toBe(true);
    expect(button("恢复默认").disabled).toBe(true);
  });

  it("saves seconds as milliseconds, disables jitter and resets only the selected source", async () => {
    await change(input("基础间隔（秒）", "QOJ"), "4");
    await act(async () => button("保存", "QOJ").click());
    await change(input("基础间隔（秒）"), "3.2");
    await change(input("随机浮动（±秒）"), "0");
    await act(async () => button("保存").click());
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_PAGINATION_POLICY",
        source: "codeforces",
        policy: { intervalMs: 3_200, jitterMs: 0 },
      }),
    );
    expect(button("保存").disabled).toBe(true);
    await act(async () => button("恢复默认").click());
    expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "codeforces", policy: null }),
    );
    expect(input("基础间隔（秒）").value).toBe("1.5");
    expect(input("随机浮动（±秒）").value).toBe("0.5");
    expect(persisted.preferences.paginationBySource?.qoj?.intervalMs).toBe(
      4_000,
    );
  });

  it("rejects empty inputs, unsafe jitter and values outside the product limits", async () => {
    await change(input("基础间隔（秒）"), "");
    expect(button("保存").disabled).toBe(true);
    await change(input("基础间隔（秒）"), "1.5");
    await focus(input("随机浮动（±秒）"));
    await change(input("随机浮动（±秒）"), "0.6");
    expect(button("保存").disabled).toBe(true);
    expect(form().querySelector('[role="alert"]')).toBeNull();
    await blur(input("随机浮动（±秒）"));
    expect(form().textContent).toContain("需保留至少 1 秒的间隔");
    expect(input("基础间隔（秒）").max).toBe("600");
    await change(input("基础间隔（秒）"), "600");
    expect(button("保存").disabled).toBe(false);
    expect(input("随机浮动（±秒）").max).toBe("599");
    await change(input("随机浮动（±秒）"), "599");
    expect(button("保存").disabled).toBe(false);
    await change(input("随机浮动（±秒）"), "599.1");
    expect(button("保存").disabled).toBe(true);
    await change(input("基础间隔（秒）"), "600.1");
    expect(button("保存").disabled).toBe(true);
    await change(input("基础间隔（秒）"), "2.05");
    expect(button("保存").disabled).toBe(true);
    await act(async () =>
      form().dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("waits for blur, hides feedback while editing again and clears it after correction", async () => {
    const interval = input("基础间隔（秒）");
    const jitter = input("随机浮动（±秒）");
    await focus(interval);
    await change(interval, "");
    expect(button("保存").disabled).toBe(true);
    expect(form().querySelector('[role="alert"]')).toBeNull();
    expect(interval.getAttribute("aria-invalid")).toBe("false");
    expect(jitter.getAttribute("aria-invalid")).toBe("false");
    await blur(interval);
    expect(form().querySelector('[role="alert"]')?.textContent).toBe(
      "请输入基础间隔。",
    );

    await focus(interval);
    expect(form().querySelector('[role="alert"]')).toBeNull();
    expect(interval.getAttribute("aria-invalid")).toBe("false");
    await change(interval, "0.5");
    expect(form().querySelector('[role="alert"]')).toBeNull();
    await blur(interval);
    expect(form().querySelector('[role="alert"]')?.textContent).toBe(
      "基础间隔不能小于 1.5 秒。",
    );

    await focus(interval);
    await change(interval, "3.2");
    await blur(interval);
    expect(form().querySelector('[role="alert"]')).toBeNull();
    expect(interval.getAttribute("aria-invalid")).toBe("false");
    expect(interval.hasAttribute("aria-describedby")).toBe(false);
    expect(button("保存").disabled).toBe(false);
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["基础间隔（秒）", "1.4", "基础间隔不能小于 1.5 秒。"],
    ["基础间隔（秒）", "600.1", "基础间隔不能超过 600 秒。"],
    ["基础间隔（秒）", "1.55", "基础间隔须以 0.1 秒递增。"],
    ["基础间隔（秒）", "2.0001", "基础间隔须以 0.1 秒递增。"],
    ["随机浮动（±秒）", "", "请输入随机浮动。"],
    ["随机浮动（±秒）", "-0.1", "随机浮动不能小于 0 秒。"],
    ["随机浮动（±秒）", "600.1", "随机浮动不能超过 600 秒。"],
    ["随机浮动（±秒）", "0.55", "随机浮动须以 0.1 秒递增。"],
    [
      "随机浮动（±秒）",
      "0.6",
      "当前基础间隔下，随机浮动不能超过 0.5 秒，需保留至少 1 秒的间隔。",
    ],
  ])(
    "shows only the relevant issue after %s = %s blurs",
    async (label, value, message) => {
      const field = input(label);
      const other = input(
        label === "基础间隔（秒）" ? "随机浮动（±秒）" : "基础间隔（秒）",
      );
      await focus(field);
      await change(field, value);
      expect(form().querySelector('[role="alert"]')).toBeNull();
      expect(field.getAttribute("aria-invalid")).toBe("false");
      expect(button("保存").disabled).toBe(true);
      await blur(field);
      const feedback = form().querySelectorAll('[role="alert"]');
      expect(feedback).toHaveLength(1);
      expect(feedback[0]!.textContent).toBe(message);
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(field.getAttribute("aria-describedby")).toBe(feedback[0]!.id);
      expect(other.getAttribute("aria-invalid")).toBe("false");
      expect(other.hasAttribute("aria-describedby")).toBe(false);
      expect(form("QOJ").querySelector('[role="alert"]')).toBeNull();
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    },
  );

  it("does not report a dependent jitter error while the base interval is invalid", async () => {
    const interval = input("基础间隔（秒）");
    await focus(input("随机浮动（±秒）"));
    await change(input("随机浮动（±秒）"), "2");
    await focus(interval);
    await change(interval, "0.5");
    await blur(interval);
    expect(form().querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(form().querySelector('[role="alert"]')?.textContent).toBe(
      "基础间隔不能小于 1.5 秒。",
    );
    expect(input("随机浮动（±秒）").getAttribute("aria-invalid")).toBe("false");

    await focus(interval);
    await change(interval, "3");
    await blur(interval);
    expect(form().querySelector('[role="alert"]')).toBeNull();
    expect(button("保存").disabled).toBe(false);
  });

  it("clears validation feedback when restoring the saved defaults", async () => {
    await focus(input("基础间隔（秒）"));
    await change(input("基础间隔（秒）"), "600.1");
    await blur(input("基础间隔（秒）"));
    expect(form().querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => button("恢复默认").click());
    expect(input("基础间隔（秒）").value).toBe("1.5");
    expect(form().querySelector('[role="alert"]')).toBeNull();
    expect(input("基础间隔（秒）").getAttribute("aria-invalid")).toBe("false");
    expect(button("保存").disabled).toBe(true);
  });

  it("blocks duplicate submissions and displays persistence errors without discarding the draft", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    vi.mocked(browser.runtime.sendMessage).mockReturnValueOnce(
      pending as never,
    );
    await change(input("基础间隔（秒）"), "3");
    await act(async () => {
      form().dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form().dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(browser.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(
      form().querySelector<HTMLFieldSetElement>("fieldset")?.disabled,
    ).toBe(true);
    expect(updated).not.toHaveBeenCalled();
    await act(async () =>
      resolve({ ok: false, error: { message: "存储失败。" } }),
    );
    expect(form().textContent).toContain("存储失败。");
    expect(input("基础间隔（秒）").value).toBe("3");
    expect(button("保存").disabled).toBe(false);
    expect(updated).not.toHaveBeenCalled();
    await act(async () => button("保存").click());
    expect(updated).toHaveBeenCalledOnce();
  });
});
