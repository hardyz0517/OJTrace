// @vitest-environment jsdom
import "./codemirror-geometry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { CnoiRulesSettings } from "../../entrypoints/settings/cnoi/CnoiRulesSettings";
import { createStoragePort } from "../../src/application/storage/store";
import { memoryStorageArea } from "../helpers/memory-storage";
import { handleRulesMessage } from "../../src/application/cnoi-rules/service";
import { saveRules } from "../../src/application/cnoi-rules/service";
import { isRulesMessage } from "../../src/application/cnoi-rules/messages";
import { markdownDiff } from "../../entrypoints/settings/cnoi/line-diff";

let root: Root, host: HTMLDivElement;
let storage: ReturnType<typeof createStoragePort>;
let changes: Set<(changes: Record<string, unknown>, area: string) => void>;
let send: ReturnType<typeof vi.fn>;
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
};
const mount = async () => {
  await act(async () => root.render(createElement(CnoiRulesSettings)));
  await settle();
};
const findButton = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes(text),
  )!;
const select = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function choose(label: string, option: string) {
  await click(select(label));
  const menu = document.querySelector(
    `[role="listbox"][aria-label="${label}"]`,
  )!;
  await click(
    [...menu.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (item) => item.textContent?.trim() === option,
    )!,
  );
}
async function change(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
function editor(label: string) {
  const el = host
    .querySelector<HTMLElement>(`[aria-label="${label}"]`)!
    .closest<HTMLElement>(".cm-editor")!;
  return EditorView.findFromDOM(el)!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  storage = createStoragePort(memoryStorageArea());
  changes = new Set();
  send = vi.fn(async (message: unknown) => {
    if (!isRulesMessage(message)) throw new Error("Invalid message");
    return handleRulesMessage(storage, message);
  });
  vi.stubGlobal("browser", {
    runtime: {
      sendMessage: send,
      getURL: (path: string) => `chrome-extension://test${path}`,
    },
    storage: {
      onChanged: {
        addListener: (fn: (c: Record<string, unknown>, a: string) => void) =>
          changes.add(fn),
        removeListener: (fn: (c: Record<string, unknown>, a: string) => void) =>
          changes.delete(fn),
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
describe("CNOI rules workspace", () => {
  it("previews the real transformer and preserves unsaved drafts while switching OJs", async () => {
    await mount();
    await choose("当前 OJ", "Codeforces");
    await settle();
    expect(editor("CNOI Markdown").state.doc.toString()).toContain(
      "## Sample Input",
    );
    const checkbox = host.querySelector<HTMLInputElement>(
      'input[aria-label="启用 context.sample-input"]',
    )!;
    await click(checkbox);
    await settle();
    expect(editor("CNOI Markdown").state.doc.toString()).not.toContain(
      "Sample Input",
    );
    expect(host.textContent).toContain("未保存");
    expect((await storage.load()).preferences.cnoiRules).toBeUndefined();
    await choose("当前 OJ", "QOJ");
    await settle();
    await choose("当前 OJ", "Codeforces");
    await settle();
    expect(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="启用 context.sample-input"]',
      )!.checked,
    ).toBe(false);
  });
  it("saves sparse overrides, restores only after saving and reloads persisted configuration", async () => {
    await mount();
    await choose("主章节标题层级", "H3 · ###");
    await settle();
    await click(findButton("保存规则"));
    expect(
      (await storage.load()).preferences.cnoiRules?.bySource.luogu?.overrides,
    ).toEqual({ sectionLevel: 3 });
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount();
    expect(host.textContent).toContain("已自定义");
    await click(findButton("恢复默认"));
    expect(
      (await storage.load()).preferences.cnoiRules?.bySource.luogu,
    ).toBeDefined();
    await click(findButton("保存规则"));
    expect((await storage.load()).preferences.cnoiRules).toBeUndefined();
  });
  it("adds, validates, edits and deletes custom rules with working previews", async () => {
    await mount();
    await click(findButton("新增规则"));
    expect(findButton("保存规则").disabled).toBe(true);
    const field = host.querySelector<HTMLInputElement>(
      'input[aria-label$="标题匹配"]',
    )!;
    await change(field, "Problem Statement");
    await settle();
    const role = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="user-"][aria-label$="目标章节"]',
    )!;
    await choose(role.getAttribute("aria-label")!, "说明 / 提示");
    await choose("章节标题", "使用规范标题");
    await settle();
    expect(editor("CNOI Markdown").state.doc.toString()).toContain("## Notes");
    expect(findButton("保存规则").disabled).toBe(false);
    await click(findButton("删除此规则"));
    expect(host.querySelector('input[aria-label$="标题匹配"]')).toBeNull();
  });
  it("detects external changes without discarding the draft and rechecks the baseline explicitly", async () => {
    await mount();
    await click(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="启用 common.input"]',
      )!,
    );
    await saveRules(storage, "luogu", { sectionLevel: 4 }, null);
    await act(async () => {
      changes.forEach((fn) => fn({ "ojtrace:data": {} }, "local"));
    });
    expect(host.textContent).toContain("其他页面修改");
    expect(findButton("保存规则").disabled).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="启用 common.input"]',
      )!.checked,
    ).toBe(false);
    await click(findButton("读取最新基线"));
    expect(findButton("保存规则").disabled).toBe(false);
  });
  it("converts edited custom Source, keeps target read-only and shows actual diff", async () => {
    await mount();
    await act(async () => {
      const view = editor("Source Markdown");
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "### Input\n\nCustom content.\n",
        },
      });
    });
    await settle();
    expect(select("测试题面").textContent).toContain("自定义 Source Markdown");
    expect(editor("CNOI Markdown").state.doc.toString()).toContain("## Input");
    expect(
      host
        .querySelector('[aria-label="CNOI Markdown"]')
        ?.getAttribute("contenteditable"),
    ).toBe("false");
    expect(host.querySelector(".diff-line-added")).not.toBeNull();
  });
  it("does not display stale asynchronous preview responses", async () => {
    await mount();
    const stale = editor("CNOI Markdown").state.doc.toString();
    const pending: ((v: unknown) => void)[] = [];
    send.mockImplementationOnce(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    await act(async () => {
      const view = editor("Source Markdown");
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "## Input\n\nOld content.\n",
        },
      });
    });
    await settle();
    await act(async () => {
      const view = editor("Source Markdown");
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "## Input\n\nLatest content.\n",
        },
      });
    });
    await settle();
    expect(editor("CNOI Markdown").state.doc.toString()).toContain(
      "Latest content.",
    );
    await act(async () =>
      pending[0]?.({
        schemaVersion: 1,
        requestId: "wrong",
        ok: true,
        type: "CNOI_PREVIEW",
        markdown: stale,
        warnings: [],
      }),
    );
    expect(editor("CNOI Markdown").state.doc.toString()).toContain(
      "Latest content.",
    );
  });
});
describe("bounded Markdown difference", () => {
  it("highlights heading edits and relocated sections", () => {
    const diff = markdownDiff(
      "## A\nAlpha\n## B\nBeta",
      "## B\nBeta\n### A\nAlpha",
    );
    expect(diff.source).toContain("removed");
    expect(diff.target).toContain("added");
    expect(diff.source).toContain("moved");
  });
});
