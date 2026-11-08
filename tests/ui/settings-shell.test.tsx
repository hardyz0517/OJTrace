// @vitest-environment jsdom
import "./codemirror-geometry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsApp } from "../../entrypoints/settings/SettingsApp";
import { createStoragePort } from "../../src/application/storage/store";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import { createAccountService } from "../../src/application/accounts/account-service";
import { handleRulesMessage } from "../../src/application/cnoi-rules/service";
import { isRulesMessage } from "../../src/application/cnoi-rules/messages";
import { updatePaginationPreference } from "../../src/application/preferences/pagination-preferences";
import type { RuntimeMessage } from "../../src/application/messaging/messages";
import { memoryStorageArea } from "../helpers/memory-storage";
import { accountRecord } from "../account-fixture";

vi.mock("../../src/platform/permissions/hosts", () => ({
  ensureAuthorizationPermission: vi.fn(async () => true),
}));
let root: Root, host: HTMLDivElement;
let storage: ReturnType<typeof createStoragePort>;
let send: ReturnType<typeof vi.fn>;
let listeners: Set<(changes: Record<string, unknown>, area: string) => void>;
const settle = async (ms = 300) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const mount = async () => {
  await act(async () => root.render(createElement(SettingsApp)));
  await settle();
};
const click = async (element: HTMLElement) => {
  expect(element).toBeTruthy();
  await act(async () => element.click());
};
async function navigate(id: string) {
  await click(
    host.querySelector<HTMLAnchorElement>(`.settings-nav-item[href="#${id}"]`)!,
  );
  await settle();
}
const panel = () =>
  host.querySelector<HTMLElement>(".settings-panel:not([hidden])")!;
const button = (text: string, scope: ParentNode = panel()) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.textContent?.includes(text),
  )!;
async function choose(label: string, text: string) {
  await click(
    panel().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!,
  );
  const menu = document.querySelector(
    `[role="listbox"][aria-label="${label}"]`,
  )!;
  await click(
    [...menu.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (option) => option.textContent?.trim() === text,
    )!,
  );
}
async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function beforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function editor(label: string) {
  return EditorView.findFromDOM(
    panel()
      .querySelector(`[aria-label="${label}"]`)!
      .closest<HTMLElement>(".cm-editor")!,
  )!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  history.replaceState(null, "", "/settings.html#accounts");
  storage = createStoragePort(memoryStorageArea());
  listeners = new Set();
  send = vi.fn(async (message: RuntimeMessage) => {
    if (isRulesMessage(message)) return handleRulesMessage(storage, message);
    const response = (type: string, extras = {}) => ({
      schemaVersion: 2,
      ok: true,
      requestId: message.requestId,
      type,
      ...extras,
    });
    switch (message.type) {
      case "GET_STATE":
        return response("STATE", {
          data: publicStoredData(await storage.load()),
        });
      case "DETECT_BROWSER_SESSION":
        return response("BROWSER_SESSION", {
          source: message.source,
          account: { authenticated: false, status: "unauthenticated" },
        });
      case "AUTHORIZE_ACCOUNT": {
        const account = accountRecord({
          accountId: "cf:tourist",
          source: message.source,
          enabled: true,
          providerAccountKey: message.identifier ?? "tourist",
          authMode: message.authMode,
        });
        const data = await storage.transact((current) => ({
          ...current,
          accounts: [account],
        }));
        return response("AUTHORIZED", {
          account,
          data: publicStoredData(data),
          superseded: false,
        });
      }
      case "DELETE_ACCOUNT":
        return response("UPDATED", {
          data: publicStoredData(
            await createAccountService(storage).remove(message.accountId),
          ),
        });
      case "UPDATE_PAGINATION_POLICY":
        return response("UPDATED", {
          data: publicStoredData(
            await updatePaginationPreference(
              storage,
              message.source,
              message.policy,
            ),
          ),
        });
      case "CLEAR_ACCOUNTS":
        return response("UPDATED", {
          data: publicStoredData(
            await createAccountService(storage).clearAll(),
          ),
        });
      case "CLEAR_SUBMISSIONS":
        return response("UPDATED", {
          data: publicStoredData(
            await storage.transact((current) => ({
              ...current,
              submissions: [],
              syncStates: {},
            })),
          ),
        });
      case "CLEAR_DATA":
        await storage.clear();
        return response("CLEARED");
      default:
        throw new Error(`Unexpected message ${message.type}`);
    }
  });
  vi.stubGlobal("browser", {
    permissions: {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true),
      remove: vi.fn(async () => true),
    },
    runtime: {
      sendMessage: send,
      getURL: (path: string) => new URL(path, location.origin).href,
    },
    storage: {
      onChanged: {
        addListener: (fn: (c: Record<string, unknown>, a: string) => void) =>
          listeners.add(fn),
        removeListener: (fn: (c: Record<string, unknown>, a: string) => void) =>
          listeners.delete(fn),
      },
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("unified settings", () => {
  it("places the Cloudflare wait optimization in the cross-OJ settings section", async () => {
    history.replaceState(null, "", "/settings.html#cross-oj");
    await mount();
    expect(panel().getAttribute("aria-label")).toBe("跨 OJ 提交");
    expect(panel().textContent).toContain("Cloudflare 验证等待优化");
    expect(
      host.querySelector('.settings-nav-item[href="#cross-oj"]')?.textContent,
    ).toContain("跨 OJ 提交");
  });

  it("selects independent modules from the URL, supports history and restores the section on refresh", async () => {
    history.replaceState(null, "", "/settings.html#collection");
    await mount();
    expect(panel().getAttribute("aria-label")).toBe("采集与同步");
    expect(host.querySelectorAll(".app-header")).toHaveLength(1);
    expect(host.querySelector(".account-form")).toBeNull();
    await navigate("data");
    expect(location.hash).toBe("#data");
    expect(panel().getAttribute("aria-label")).toBe("本地数据");
    await act(async () => history.back());
    await settle();
    expect(panel().getAttribute("aria-label")).toBe("采集与同步");
    await act(async () => history.forward());
    await settle();
    expect(panel().getAttribute("aria-label")).toBe("本地数据");
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount();
    expect(panel().getAttribute("aria-label")).toBe("本地数据");
    expect(
      host.querySelector('[aria-current="page"]')?.getAttribute("href"),
    ).toBe("#data");
  });

  it("keeps account and collection drafts across section changes, protects leaving and saves through existing commands", async () => {
    await mount();
    await choose("选择方式", "直接输入用户名");
    const accountInput =
      panel().querySelector<HTMLInputElement>('input[name="identifier"]') ??
      panel().querySelector<HTMLInputElement>(".auth-panel input")!;
    await change(accountInput, "tourist");
    expect(beforeUnload()).toBe(true);
    await navigate("collection");
    const interval = panel().querySelector<HTMLInputElement>(
      'input[aria-label="Codeforces 基础间隔（秒）"]',
    )!;
    await change(interval, "3");
    await navigate("data");
    expect(beforeUnload()).toBe(true);
    await navigate("accounts");
    expect(accountInput.value).toBe("tourist");
    await click(button("添加账号"));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "AUTHORIZE_ACCOUNT",
        identifier: "tourist",
        source: "codeforces",
        authMode: "public-handle",
      }),
    );
    expect(panel().textContent).toContain("tourist");
    await navigate("collection");
    expect(interval.value).toBe("3");
    await click(
      interval
        .closest("form")!
        .querySelector<HTMLButtonElement>('button[aria-label="保存"]')!,
    );
    expect(
      (await storage.load()).preferences.paginationBySource?.codeforces
        ?.intervalMs,
    ).toBe(3000);
    expect(beforeUnload()).toBe(false);
    await navigate("accounts");
    await click(
      panel().querySelector<HTMLButtonElement>(
        'button[aria-label="删除账号"]',
      )!,
    );
    expect((await storage.load()).accounts).toHaveLength(0);
  });

  it("retains CNOI rules, Source edits and OJ selection while hidden, saves and reloads real rules", async () => {
    history.replaceState(null, "", "/settings.html#cnoi");
    await mount();
    expect(panel().classList.contains("settings-panel-wide")).toBe(true);
    expect(host.querySelectorAll(".app-header")).toHaveLength(1);
    expect(host.querySelector(".rules-breadcrumb")).toBeNull();
    await choose("当前 OJ", "Codeforces");
    await settle();
    await choose("主章节标题层级", "H3 · ###");
    await act(async () => {
      const source = editor("Source Markdown");
      source.dispatch({
        changes: {
          from: 0,
          to: source.state.doc.length,
          insert: "## Input\n\nCustom body.\n",
        },
      });
    });
    await settle();
    expect(editor("CNOI Markdown").state.doc.toString()).toContain("### Input");
    expect(beforeUnload()).toBe(true);
    await navigate("collection");
    expect((await storage.load()).preferences.cnoiRules).toBeUndefined();
    await navigate("cnoi");
    expect(
      panel().querySelector('button[aria-label="当前 OJ"]')!.textContent,
    ).toContain("Codeforces");
    expect(editor("Source Markdown").state.doc.toString()).toContain(
      "Custom body.",
    );
    expect(panel().textContent).toContain("未保存");
    await click(button("保存规则"));
    expect(
      (await storage.load()).preferences.cnoiRules?.bySource.codeforces
        ?.overrides,
    ).toEqual({ sectionLevel: 3 });
    expect(beforeUnload()).toBe(false);
    await click(button("恢复默认"));
    expect(beforeUnload()).toBe(true);
    await click(button("保存规则"));
    expect((await storage.load()).preferences.cnoiRules).toBeUndefined();
    const activeHeader = host.querySelector<HTMLAnchorElement>(
      ".app-nav a.is-active",
    )!;
    await click(activeHeader);
    expect(location.hash).toBe("#cnoi");
    expect(editor("Source Markdown").state.doc.toString()).toContain(
      "Custom body.",
    );
  });

  it("requires explicit confirmation for every cleanup and preserves preferences when clearing accounts", async () => {
    await updatePaginationPreference(storage, "luogu", {
      intervalMs: 3000,
      jitterMs: 500,
    });
    history.replaceState(null, "", "/settings.html#data");
    await mount();
    await click(button("清除账号"));
    expect(
      send.mock.calls.some(([message]) => message.type === "CLEAR_ACCOUNTS"),
    ).toBe(false);
    await click(button("取消", host.querySelector('[role="alertdialog"]')!));
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    for (const [label, command] of [
      ["清除账号", "CLEAR_ACCOUNTS"],
      ["清除记录", "CLEAR_SUBMISSIONS"],
      ["清除全部", "CLEAR_DATA"],
    ]) {
      await click(button(label!));
      const dialog = host.querySelector('[role="alertdialog"]')!;
      await click(dialog.querySelector<HTMLButtonElement>(".danger-button")!);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: command }),
      );
      expect(host.querySelector('[role="alertdialog"]')).toBeNull();
      if (command !== "CLEAR_DATA")
        expect(
          (await storage.load()).preferences.paginationBySource?.luogu,
        ).toBeDefined();
    }
    expect(
      (await storage.load()).preferences.paginationBySource,
    ).toBeUndefined();
  });

  it("falls back from unknown URLs and collapses navigation without unmounting the active workspace", async () => {
    history.replaceState(null, "", "/settings.html#unknown");
    await mount();
    expect(location.hash).toBe("#accounts");
    const form = panel().querySelector(".account-form");
    await click(
      host.querySelector<HTMLButtonElement>(
        'button[aria-label="收起设置导航"]',
      )!,
    );
    expect(
      host
        .querySelector(".settings-shell")
        ?.classList.contains("is-sidebar-collapsed"),
    ).toBe(true);
    expect(panel().querySelector(".account-form")).toBe(form);
  });
});
