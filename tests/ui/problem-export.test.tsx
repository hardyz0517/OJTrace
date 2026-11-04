import "./codemirror-geometry";
import { cnoiFixture } from "../problem/source-test-helpers";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rendererMocks = vi.hoisted(() => ({
  render: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("../../src/problem/render/typst-renderer", () => ({
  isTypstSvg(value: unknown): value is string {
    return (
      typeof value === "string" &&
      /^\s*(?:<\?xml\b[^>]*>\s*)?<svg\b/i.test(value)
    );
  },
}));
vi.mock("../../src/problem/render/worker-problem-renderer", () => ({
  WorkerProblemRenderer: class {
    pdf = rendererMocks.render;
    preview = rendererMocks.preview;
    dispose = vi.fn();
  },
}));

import { ProblemExport } from "../../entrypoints/problem-export/ProblemExport";

type Listener = (value?: unknown) => void;

function makePort() {
  const messageListeners = new Set<Listener>();
  const disconnectListeners = new Set<Listener>();
  return {
    name: "problem-export",
    onMessage: {
      addListener: (listener: Listener) => messageListeners.add(listener),
      removeListener: (listener: Listener) => messageListeners.delete(listener),
    },
    onDisconnect: {
      addListener: (listener: Listener) => disconnectListeners.add(listener),
      removeListener: (listener: Listener) =>
        disconnectListeners.delete(listener),
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(() => {
      for (const listener of disconnectListeners) listener();
    }),
    emit(value: unknown) {
      for (const listener of messageListeners) listener(value);
    },
    interrupt() {
      for (const listener of disconnectListeners) listener();
    },
  };
}

const problem = {
  oj: "luogu" as const,
  problemId: "P1001",
  title: "A+B Problem",
  originalUrl: "https://www.luogu.com.cn/problem/P1001",
  timeLimit: { display: "1 s", milliseconds: 1000 },
  memoryLimit: { display: "128 MB", bytes: 128 * 1024 * 1024 },
  ast: {
    type: "root" as const,
    children: [
      {
        type: "paragraph" as const,
        children: [{ type: "text" as const, value: "Compute a sum." }],
      },
    ],
  },

  assets: [],
  warnings: [
    { code: "image-unembedded", message: "图片无法嵌入 PDF。" },
    { code: "math-unrecognized", message: "部分数学公式无法识别。" },
  ],
};

const token = "0123456789abcdef0123456789abcdef";
const eventBase = {
  schemaVersion: 2 as const,
  requestId: "request-id",
  token,
};

let root: Root;
let container: HTMLDivElement;
let port: ReturnType<typeof makePort>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const realURL = window.URL;
  vi.spyOn(window, "URL", "get").mockReturnValue(realURL);
  window.history.replaceState({}, "", `/?token=${token}`);
  port = makePort();
  vi.stubGlobal("browser", {
    runtime: { connect: vi.fn(() => port) },
  });
  rendererMocks.render.mockRejectedValue(new Error("WASM unavailable"));
  rendererMocks.preview.mockRejectedValue(new Error("preview unused"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    root.render(createElement(ProblemExport));
    await Promise.resolve();
  });
}

function emitDocument(): void {
  port.emit({
    ...eventBase,
    type: "PROBLEM_EXPORT_DOCUMENT",
    problem: cnoiFixture(problem),
  });
}

describe("problem export page", () => {
  it("rejects a missing token without opening a runtime port", async () => {
    window.history.replaceState({}, "", "/problem-export.html");
    await renderPage();

    expect(container.textContent).toContain("导出任务已失效");
    expect(browser.runtime.connect).not.toHaveBeenCalled();
  });

  it("accepts the current token, disconnects after delivery, and reports extraction warnings", async () => {
    await renderPage();
    await act(async () => {
      port.emit({
        ...eventBase,
        token: "different-token-0123456789",
        type: "PROBLEM_EXPORT_DOCUMENT",
        problem: cnoiFixture(problem),
      });
    });
    expect(container.textContent).toContain("正在读取题面");

    await act(async () => emitDocument());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("题面提示");
    expect(container.textContent).toContain("图片无法嵌入 PDF");
    expect(container.textContent).toContain("部分数学公式无法识别");
    expect(
      container.querySelector('[aria-label="题面 Markdown"]'),
    ).not.toBeNull();
    expect(rendererMocks.render).not.toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("打印预览");
  });

  it("reports a disconnect before document delivery as a terminal failure", async () => {
    await renderPage();
    await act(async () => port.interrupt());
    expect(container.textContent).toContain("后台连接在题面到达前中断");
    expect(container.textContent).toContain("回到题目页");
  });

  it("ignores document delivery after the editor page unmounts", async () => {
    await renderPage();
    await act(async () => root.unmount());
    emitDocument();
    await act(async () => Promise.resolve());
    expect(rendererMocks.render).not.toHaveBeenCalled();
    expect(rendererMocks.preview).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("PDF 已生成并下载");
  });

  it("keeps the editor after delivery and does not download or time out", async () => {
    vi.useFakeTimers();
    const previousCreate = URL.createObjectURL;
    const previousRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" class="typst-doc" viewBox="0 0 596 842"><text x="30" y="30">题面预览</text></svg>';
    let resolveRender: (value: string) => void = () => undefined;
    rendererMocks.preview.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRender = resolve;
        }),
    );
    // The page always opens the editor, including old URLs with no intent.
    window.history.replaceState({}, "", `/?token=${token}`);
    try {
      await renderPage();
      expect(port.postMessage).toHaveBeenCalledTimes(1);
      await act(async () => {
        emitDocument();
        await Promise.resolve();
      });
      expect(port.disconnect).toHaveBeenCalledTimes(1);
      expect(
        container.querySelector('[aria-label="题面 Markdown"]'),
      ).not.toBeNull();
      expect(container.textContent).toContain("导出 PDF");
      await act(async () => {
        resolveRender(svg);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector("iframe")).toBeNull();
      expect(
        container
          .querySelector(".typst-preview-host")
          ?.shadowRoot?.querySelector("svg")
          ?.getAttribute("style") ?? "",
      ).toContain("width: 100%");
      expect(rendererMocks.render).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });
      expect(container.textContent).toContain("导出 PDF");
      expect(container.textContent).not.toContain("读取题面超时");
      expect(container.textContent).not.toContain("PDF 已生成并下载");
      expect(click).not.toHaveBeenCalled();
      expect(port.postMessage).toHaveBeenCalledTimes(1);
    } finally {
      if (previousCreate) URL.createObjectURL = previousCreate;
      else delete (URL as { createObjectURL?: unknown }).createObjectURL;
      if (previousRevoke) URL.revokeObjectURL = previousRevoke;
      else delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      vi.useRealTimers();
    }
  });

  it("fails explicitly when no document arrives before the bounded timeout", async () => {
    vi.useFakeTimers();
    await renderPage();

    await act(async () => {
      vi.advanceTimersByTime(90_000);
    });
    expect(container.textContent).toContain("读取题面超时");
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it("fails promptly for an old background protocol", async () => {
    await renderPage();
    await act(async () =>
      port.emit({
        ...eventBase,
        schemaVersion: 1,
        type: "PROBLEM_EXPORT_DOCUMENT",
        document: problem,
      }),
    );
    expect(container.textContent).toContain("扩展已更新");
    expect(port.disconnect).toHaveBeenCalledOnce();
  });
});
