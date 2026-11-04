import "./codemirror-geometry";
import { parseMarkdown } from "../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../src/problem/markdown/serialize";
import { cnoiFixture } from "../problem/source-test-helpers";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";

vi.mock("../../src/problem/markdown/parse", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/problem/markdown/parse")
  >("../../src/problem/markdown/parse");
  return {
    parseMarkdown(markdown: string, options: { baseUrl?: string }) {
      if (markdown.includes("<<bad>>")) throw new Error("bad markdown");
      return actual.parseMarkdown(markdown, options);
    },
  };
});

import { ProblemStudio } from "../../entrypoints/problem-export/ProblemStudio";
import type { RenderDocument } from "../../src/problem/domain";
import { serializeProblemMarkdown } from "../../src/problem/problem-markdown";

const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

const baseDocument = {
  oj: "luogu",
  problemId: "P1001",
  title: "A+B Problem",
  originalUrl: "https://www.luogu.com.cn/problem/P1001",
  timeLimit: { display: "1 s", milliseconds: 1_000 },
  memoryLimit: { display: "128 MB", bytes: 128 * 1024 * 1024 },
  language: "zh",
  ast: {
    type: "root" as const,
    children: [
      {
        type: "heading",
        level: 2,
        children: [{ type: "text", value: "题目描述" }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", value: "计算。" }],
      },
    ],
  },

  assets: [],
  warnings: [],
} satisfies RenderDocument;
const base = { ...baseDocument, ...cnoiFixture(baseDocument) };

let root: Root;
let container: HTMLDivElement;
let restoreUrls: (() => void) | undefined;

function installBlobUrls(): () => void {
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  return () => {
    if (previousCreate) URL.createObjectURL = previousCreate;
    else delete (URL as { createObjectURL?: unknown }).createObjectURL;
    if (previousRevoke) URL.revokeObjectURL = previousRevoke;
    else delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  };
}

function markdownEditor(): EditorView {
  const element = container.querySelector<HTMLElement>(".cm-editor");
  const view = element && EditorView.findFromDOM(element);
  if (!view) throw new Error("missing Markdown editor");
  return view;
}

async function setControl(editor: EditorView, value: string) {
  await setSource(editor, serializeProblemMarkdown({ ...base }, value));
}

async function setSource(editor: EditorView, value: string) {
  await act(async () => {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  restoreUrls = installBlobUrls();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  restoreUrls?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("problem studio", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" class="typst-doc" viewBox="0 0 596 842"><text x="30" y="30">题面预览</text></svg>';

  function mountedSvg(): SVGElement | null {
    return (
      container
        .querySelector(".typst-preview-host")
        ?.shadowRoot?.querySelector("svg") ?? null
    );
  }

  it("edits one complete Markdown document without a separate metadata form", async () => {
    const renderPreview = vi.fn(async () => svg);
    await act(async () =>
      root.render(
        createElement(ProblemStudio, {
          base,
          renderPreview,
          renderPdf: vi.fn(async () => pdf),
        }),
      ),
    );
    const source = markdownEditor().state.doc.toString();
    expect(source).toBe(
      serializeProblemMarkdown(base, serializeMarkdown(base.ast.children)),
    );
    expect(source).toContain('title: "A+B Problem"');
    expect(source).toContain("time_limit: 1 s");
    expect(source).toContain("memory_limit: 128 MB");
    expect(source).toContain("---\n\n## 题目描述");
    expect(source).not.toMatch(/^# /m);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector(".problem-studio-meta")).toBeNull();
    expect(
      container.querySelector(".problem-studio-breadcrumb")?.textContent,
    ).toContain("洛谷 P1001");
    expect(renderPreview).toHaveBeenCalledWith(
      expect.objectContaining({ title: base.title, ast: base.ast }),
    );
  });

  it("takes preview metadata, breadcrumb and download filename from front matter", async () => {
    const renderPreview = vi.fn(async () => svg);
    const renderPdf = vi.fn(async () => pdf);
    const filenames: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      filenames.push(this.download);
    });
    await act(async () =>
      root.render(
        createElement(ProblemStudio, { base, renderPreview, renderPdf }),
      ),
    );
    const source = markdownEditor()
      .state.doc.toString()
      .replace("oj: luogu", "oj: qoj")
      .replace("id: P1001", "id: 42")
      .replace('title: "A+B Problem"', 'title: "新标题"')
      .replace("time_limit: 1 s", "time_limit: 4 s")
      .replace("memory_limit: 128 MB", "memory_limit: 512 MB")
      .replace(
        "https://www.luogu.com.cn/problem/P1001",
        "https://qoj.ac/problem/42",
      );
    await setSource(markdownEditor(), source);
    expect(
      container.querySelector(".problem-studio-breadcrumb")?.textContent,
    ).toContain("QOJ 42");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const expected = expect.objectContaining({
      oj: "qoj",
      problemId: "42",
      title: "新标题",
      originalUrl: "https://qoj.ac/problem/42",
      timeLimit: { display: "4 s", milliseconds: 4000 },
      memoryLimit: { display: "512 MB", bytes: 512 * 1024 ** 2 },
      ast: base.ast,
    });
    expect(renderPreview).toHaveBeenLastCalledWith(expected);
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".studio-export")!.click(),
    );
    expect(renderPdf).toHaveBeenCalledWith(expected);
    expect(filenames).toEqual(["42-新标题.pdf"]);
  });

  it.each([
    ['title: "A+B Problem"', 'title: ""', "title"],
    ["\n---\n\n", "\n\n", "尚未结束"],
    ["time_limit: 1 s", "time_limit: [1, s]", "time_limit"],
  ])(
    "keeps the visible preview and blocks cached downloads after invalid metadata: %s",
    async (from, to, error) => {
      const renderPreview = vi.fn(async () => svg);
      const renderPdf = vi.fn(async () => pdf);
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      await act(async () =>
        root.render(
          createElement(ProblemStudio, { base, renderPreview, renderPdf }),
        ),
      );
      await act(async () =>
        container.querySelector<HTMLButtonElement>(".studio-export")!.click(),
      );
      const previous = mountedSvg();
      expect(click).toHaveBeenCalledTimes(1);
      const valid = markdownEditor().state.doc.toString();
      await setSource(markdownEditor(), valid.replace(from, to));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      await act(async () =>
        container.querySelector<HTMLButtonElement>(".studio-export")!.click(),
      );
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        error,
      );
      expect(mountedSvg()).toBe(previous);
      expect(renderPdf).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      await setSource(markdownEditor(), valid);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(markdownEditor().state.doc.toString()).toBe(valid);
    },
  );

  it("keeps one compile in flight and replaces the single waiting draft", async () => {
    const pending: Array<(value: string) => void> = [];
    const renderPreview = vi.fn(
      (_document: RenderDocument) =>
        new Promise<string>((resolve) => {
          pending.push(resolve);
        }),
    );
    const renderPdf = vi.fn(async () => pdf);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await act(async () => {
      root.render(
        createElement(ProblemStudio, {
          base,
          renderPreview,
          renderPdf,
        }),
      );
      await Promise.resolve();
    });
    expect(renderPreview).toHaveBeenCalledTimes(1);
    expect(renderPreview.mock.calls[0]?.[0]?.ast).toEqual(base.ast);
    expect(renderPdf).not.toHaveBeenCalled();

    const markdown = markdownEditor();
    await setControl(markdown, "one");
    await setControl(markdown, "two");
    await setControl(markdown, "three");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(renderPreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(renderPreview).toHaveBeenCalledTimes(1);
    await setControl(markdown, "four");
    expect(renderPreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0]?.(svg);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderPreview).toHaveBeenCalledTimes(2);
    expect(
      serializeMarkdown(renderPreview.mock.calls[1]![0]!.ast.children),
    ).toContain("four");
    expect(mountedSvg()).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    await act(async () => {
      pending[1]?.(svg);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mountedSvg()?.getAttribute("style") ?? "").toContain("width: 100%");
    expect(markdown.state.doc.toString()).toBe(
      serializeProblemMarkdown({ ...base }, "four"),
    );
    expect(click).not.toHaveBeenCalled();
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it("does not download the previous PDF after a compile or parse failure", async () => {
    const renderPreview = vi.fn(async (document: RenderDocument) => {
      if (serializeMarkdown(document.ast.children).includes("坏"))
        throw new Error("wasm exploded");
      return svg;
    });
    const renderPdf = vi.fn(async (document: RenderDocument) => {
      if (serializeMarkdown(document.ast.children).includes("坏"))
        throw new Error("wasm exploded");
      return pdf;
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await act(async () => {
      root.render(
        createElement(ProblemStudio, {
          base,
          renderPreview,
          renderPdf,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mountedSvg()).not.toBeNull();
    expect(renderPdf).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    const markdown = markdownEditor();
    await setControl(markdown, "坏掉的题面");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(container.textContent).toContain("预览已过期");
    expect(container.textContent).toContain("wasm exploded");
    expect(click).not.toHaveBeenCalled();
    expect(renderPdf).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".studio-export")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(renderPreview).toHaveBeenCalledTimes(2);
    expect(click).not.toHaveBeenCalled();

    await setControl(markdown, "<<bad>>说明");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(container.textContent).toContain("题面 Markdown 无法解析");
    expect(renderPreview).toHaveBeenCalledTimes(2);
    expect(renderPdf).toHaveBeenCalledTimes(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".studio-export")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(mountedSvg()).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("compiles the PDF once for the current draft and reuses those bytes", async () => {
    const renderPreview = vi.fn(async () => svg);
    const renderPdf = vi.fn(async () => pdf);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await act(async () => {
      root.render(
        createElement(ProblemStudio, {
          base,
          renderPreview,
          renderPdf,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderPreview).toHaveBeenCalledTimes(1);
    expect(renderPdf).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".studio-export")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(renderPreview).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".studio-export")!.click();
      await Promise.resolve();
    });
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(2);
  });

  it("keeps folded Markdown intact for preview and PDF without compiling a fold action", async () => {
    const markdown =
      "## 描述\n\n完整题面。\n\n### 样例\n```text\n6 4\n```\n\n## 输出\n\n91\n";
    const renderPreview = vi.fn(async () => svg);
    const renderPdf = vi.fn(async () => pdf);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () =>
      root.render(
        createElement(ProblemStudio, {
          base: {
            ...base,
            cnoiMarkdown: serializeProblemMarkdown(base, markdown),
          },
          renderPreview,
          renderPdf,
        }),
      ),
    );
    await act(async () => {
      container
        .querySelector<HTMLElement>('.cm-foldGutter [title="折叠内容"]')!
        .click();
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(renderPreview).toHaveBeenCalledTimes(1);
    expect(markdownEditor().state.doc.toString()).toBe(
      serializeProblemMarkdown(base, markdown),
    );
    expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".studio-export")!.click(),
    );
    expect(renderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        ast: parseMarkdown(markdown, { baseUrl: base.originalUrl }).ast,
      }),
    );
  });

  it("waits for Chinese composition to finish and drops an older waiting draft", async () => {
    let resolveInitial: (value: string) => void = () => {};
    const renderPreview = vi
      .fn<(_document: RenderDocument) => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockResolvedValue(svg);
    await act(async () =>
      root.render(
        createElement(ProblemStudio, {
          base,
          renderPreview,
          renderPdf: vi.fn(async () => pdf),
        }),
      ),
    );
    const editor = markdownEditor();
    await setControl(editor, "old waiting draft");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await act(async () => {
      editor.contentDOM.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
    });
    await setControl(editor, "正在输入中文");
    await act(async () => {
      resolveInitial(svg);
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(renderPreview).toHaveBeenCalledTimes(1);
    await act(async () => {
      editor.contentDOM.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "中文" }),
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(renderPreview).toHaveBeenCalledTimes(2);
    expect(renderPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ast: expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              type: "paragraph",
              children: [{ type: "text", value: "正在输入中文" }],
            }),
          ]),
        }),
      }),
    );
  });

  it("reports an XML parse failure on the first preview and can retry", async () => {
    const renderPreview = vi
      .fn<(_document: RenderDocument) => Promise<string>>()
      .mockResolvedValueOnce(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>const text = "&nbsp;";</script></svg>',
      )
      .mockResolvedValue(svg);
    const renderPdf = vi.fn(async () => pdf);
    await act(async () => {
      root.render(
        createElement(ProblemStudio, {
          base,
          renderPreview,
          renderPdf,
        }),
      );
    });
    expect(mountedSvg()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "预览 SVG 数据无效",
    );
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".preview-diagnostic button")!
        .click();
    });
    expect(renderPreview).toHaveBeenCalledTimes(2);
    expect(mountedSvg()?.textContent).toContain("题面预览");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 842"><text>empty viewport</text></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 596 842"></svg>',
  ])(
    "keeps the last visible preview when an update returns invalid SVG: %s",
    async (invalid) => {
      const renderPreview = vi.fn(async (document: RenderDocument) =>
        serializeMarkdown(document.ast.children) ===
        serializeMarkdown(base.ast.children)
          ? svg
          : invalid,
      );
      await act(async () => {
        root.render(
          createElement(ProblemStudio, {
            base,
            renderPreview,
            renderPdf: vi.fn(async () => pdf),
          }),
        );
      });
      const previous = mountedSvg();
      expect(previous).not.toBeNull();
      await setControl(markdownEditor(), "updated draft");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(mountedSvg()).toBe(previous);
      expect(container.textContent).toContain("预览已过期");
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "预览 SVG 数据无效",
      );
    },
  );
  it("preserves edits across rerenders and resets state/cache only for a new task", async () => {
    const renderPreview = vi.fn(async () => svg),
      renderPdf = vi.fn(async () => pdf);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () =>
      root.render(
        createElement(ProblemStudio, {
          key: "task-1",
          base,
          renderPreview,
          renderPdf,
        }),
      ),
    );
    await setControl(markdownEditor(), "# User title\n\nChanged draft.");
    await act(async () => vi.advanceTimersByTimeAsync(400));
    const edited = markdownEditor().state.doc.toString();
    await act(async () =>
      root.render(
        createElement(ProblemStudio, {
          key: "task-1",
          base: { ...base },
          renderPreview: async () => renderPreview(),
          renderPdf,
        }),
      ),
    );
    expect(markdownEditor().state.doc.toString()).toBe(edited);
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".studio-export")!.click(),
    );
    expect(renderPdf).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ast: parseMarkdown("# User title\n\nChanged draft.\n").ast,
      }),
    );
    expect(base.cnoiMarkdown).toBe(cnoiFixture(baseDocument).cnoiMarkdown);
    await act(async () =>
      root.render(
        createElement(ProblemStudio, {
          key: "task-2",
          base,
          renderPreview,
          renderPdf,
        }),
      ),
    );
    expect(markdownEditor().state.doc.toString()).toBe(base.cnoiMarkdown);
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".studio-export")!.click(),
    );
    expect(renderPdf).toHaveBeenCalledTimes(2);
    expect(renderPdf).toHaveBeenLastCalledWith(
      expect.objectContaining({ ast: base.ast }),
    );
  });
});
