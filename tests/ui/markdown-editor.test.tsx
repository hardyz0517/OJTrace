// @vitest-environment jsdom
import "./codemirror-geometry";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import {
  foldable,
  foldedRanges,
  foldEffect,
  ensureSyntaxTree,
} from "@codemirror/language";
import { redo, undo } from "@codemirror/commands";
import { MarkdownEditor } from "../../entrypoints/shared/MarkdownEditor";

const source = [
  "## 题目描述",
  "",
  "给定一个序列 $a_i$。",
  "",
  "### 输入 #1",
  "```text",
  "# 这是样例内容，不是标题",
  "6 4",
  "```",
  "",
  "## 输出格式",
  "",
  "输出答案。",
].join("\n");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function editor(): EditorView {
  const view = EditorView.findFromDOM(
    container.querySelector<HTMLElement>(".cm-editor")!,
  );
  if (!view) throw new Error("missing Markdown editor");
  ensureSyntaxTree(view.state, view.state.doc.length, 100);
  return view;
}

async function mount(value = source, onChange = vi.fn()) {
  await act(async () => {
    root.render(createElement(MarkdownEditor, { value, onChange }));
  });
  return { view: editor(), onChange };
}

describe("Markdown editor", () => {
  it("keeps front matter visually secondary and foldable without breaking body folding", async () => {
    const source =
      '---\noj: luogu\nid: P6187\ntitle: "# not a heading"\nurl: https://www.luogu.com.cn/problem/P6187\ntime_limit: 2 s\nmemory_limit: 250 MB\n---\n\n## 题目描述\n\n正文\n\n## 输出\n\n答案\n';
    const { view, onChange } = await mount(source);
    expect(container.querySelectorAll(".cm-frontmatter-line")).toHaveLength(8);
    const bodyLine = [...container.querySelectorAll(".cm-line")].find(
      (line) => line.textContent === "## 题目描述",
    );
    expect(bodyLine?.classList.contains("cm-frontmatter-line")).toBe(false);
    const title = view.state.doc.line(4);
    expect(foldable(view.state, title.from, title.to)).toBeNull();
    const section = view.state.doc.line(10);
    expect(foldable(view.state, section.from, section.to)).not.toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLElement>('.cm-foldGutter [title="折叠内容"]')!
        .click(),
    );
    expect(view.contentDOM.textContent).not.toContain("title:");
    expect(view.contentDOM.textContent).toContain("## 题目描述");
    expect(view.state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("shows logical line numbers followed by fold arrows and keeps the complete source", async () => {
    const { view, onChange } = await mount();
    expect(view.contentDOM.getAttribute("aria-label")).toBe("题面 Markdown");
    expect(view.contentDOM.getAttribute("spellcheck")).toBe("false");
    expect(view.lineWrapping).toBe(true);
    const gutters = [...container.querySelectorAll(".cm-gutter")];
    expect(gutters[0]?.classList.contains("cm-lineNumbers")).toBe(true);
    expect(gutters[1]?.classList.contains("cm-foldGutter")).toBe(true);
    expect(
      container.querySelector('.cm-foldGutter [title="折叠内容"]'),
    ).not.toBeNull();
    expect(view.state.doc.lines).toBe(13);
    expect(view.state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("folds a heading through nested headings, stopping before the next peer heading", async () => {
    const { view, onChange } = await mount();
    const line = view.state.doc.line(1);
    expect(foldable(view.state, line.from, line.to)).toEqual({
      from: line.to,
      to: view.state.doc.line(9).to,
    });
    // Use the actual gutter click path, rather than applying a fold in the test.
    await act(async () => {
      container
        .querySelector<HTMLElement>('.cm-foldGutter [title="折叠内容"]')!
        .click();
    });
    expect(foldedRanges(view.state).size).toBe(1);
    expect(
      container.querySelector(".cm-foldPlaceholder")?.getAttribute("title"),
    ).toBe("展开内容");
    expect(view.contentDOM.textContent).not.toContain("给定一个序列");
    expect(view.contentDOM.textContent).toContain("## 输出格式");
    expect(view.state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLElement>(".cm-foldPlaceholder")!.click();
    });
    expect(foldedRanges(view.state).size).toBe(0);
    expect(view.contentDOM.textContent).toContain("给定一个序列");
  });

  it("folds fenced code without treating a sample's hash as a heading", async () => {
    const { view } = await mount();
    const fence = view.state.doc.line(6);
    expect(foldable(view.state, fence.from, fence.to)).toEqual({
      from: fence.to,
      to: view.state.doc.line(9).to,
    });
    const sample = view.state.doc.line(7);
    expect(foldable(view.state, sample.from, sample.to)).toBeNull();
    const range = foldable(view.state, fence.from, fence.to)!;
    await act(async () => view.dispatch({ effects: foldEffect.of(range) }));
    expect(view.contentDOM.textContent).not.toContain("这是样例内容");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("supports folding Setext headings and GFM tables", async () => {
    const { view } = await mount(
      "题目描述\n========\n\n正文。\n\n## 数据\n\n| A | B |\n| - | - |\n| 1 | 2 |\n",
    );
    for (const lineNumber of [1, 6, 8]) {
      const line = view.state.doc.line(lineNumber);
      expect(foldable(view.state, line.from, line.to)).not.toBeNull();
    }
  });

  it("preserves the editor, selection, folds and undo history across parent renders", async () => {
    const { view, onChange } = await mount();
    const line = view.state.doc.line(6);
    await act(async () => {
      view.dispatch({
        effects: foldEffect.of(foldable(view.state, line.from, line.to)!),
      });
      view.dispatch({
        changes: { from: source.length, insert: "追加文本" },
        selection: { anchor: 2 },
      });
    });
    const next = view.state.doc.toString();
    await act(async () =>
      root.render(createElement(MarkdownEditor, { value: next, onChange })),
    );
    expect(editor()).toBe(view);
    expect(view.state.selection.main.anchor).toBe(2);
    expect(foldedRanges(view.state).size).toBe(1);
    await act(async () => {
      expect(undo(view)).toBe(true);
    });
    expect(view.state.doc.toString()).toBe(source);
    await act(async () => {
      expect(redo(view)).toBe(true);
    });
    expect(view.state.doc.toString()).toBe(next);
    expect(onChange).toHaveBeenLastCalledWith(next, false);
  });

  it("applies a replacement value without notifying an edit back to the parent", async () => {
    const { view, onChange } = await mount();
    await act(async () =>
      root.render(
        createElement(MarkdownEditor, { value: "## 新题面\n\n内容", onChange }),
      ),
    );
    expect(editor()).toBe(view);
    expect(view.state.doc.toString()).toBe("## 新题面\n\n内容");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("handles undo and redo through keyboard bindings", async () => {
    const { view } = await mount();
    await act(async () => {
      view.dispatch({ changes: { from: source.length, insert: "键盘编辑" } });
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(view.state.doc.toString()).toBe(source);
    await act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "y",
          code: "KeyY",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(view.state.doc.toString()).toBe(source + "键盘编辑");
    await act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Z",
          code: "KeyZ",
          keyCode: 90,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(view.state.doc.toString()).toBe(source + "键盘编辑");
  });

  it("handles IME composition and ignores a queued completion after unmount", async () => {
    const { view, onChange } = await mount();
    await act(async () => {
      view.contentDOM.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      view.dispatch({
        changes: { from: 0, to: source.length, insert: "中文输入" },
      });
    });
    expect(onChange).toHaveBeenLastCalledWith("中文输入", true);
    await act(async () => {
      view.contentDOM.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "中文输入",
        }),
      );
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenLastCalledWith("中文输入", false);
    const destroy = vi.spyOn(view, "destroy");
    await act(async () => {
      view.contentDOM.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      root.render(null);
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("cleans up correctly when React runs mount effects twice", async () => {
    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(MarkdownEditor, { value: source, onChange: vi.fn() }),
        ),
      ),
    );
    expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(editor().state.doc.toString()).toBe(source);
  });
});
