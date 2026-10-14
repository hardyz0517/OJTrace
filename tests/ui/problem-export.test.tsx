// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rendererMocks = vi.hoisted(() => ({
  render: vi.fn(),
  renderHtml: vi.fn(),
}));

vi.mock("../../src/problem/render/typst-renderer", () => ({
  TypstProblemRenderer: class {
    render = rendererMocks.render;
  },
}));
vi.mock("../../src/problem/render/browser-typst-compiler", () => ({
  BrowserTypstCompiler: class {},
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
  blocks: [
    {
      type: "paragraph" as const,
      children: [{ type: "text" as const, value: "Compute a sum." }],
    },
  ],
  markdown: "Compute a sum.",
  assets: [],
  warnings: [
    { code: "image-unembedded", message: "图片无法嵌入 PDF。" },
    { code: "math-unrecognized", message: "部分数学公式无法识别。" },
  ],
};

const token = "0123456789abcdef0123456789abcdef";
const eventBase = {
  schemaVersion: 1 as const,
  requestId: "request-id",
  token,
};

let root: Root;
let container: HTMLDivElement;
let port: ReturnType<typeof makePort>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "URL", "get").mockReturnValue(URL);
  window.history.replaceState({}, "", `/?token=${token}`);
  port = makePort();
  vi.stubGlobal("browser", {
    runtime: { connect: vi.fn(() => port) },
  });
  rendererMocks.render.mockRejectedValue(new Error("WASM unavailable"));
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
    document: problem,
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
        document: problem,
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
    expect(container.textContent).toContain("PDF 生成失败");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("打印预览");
  });

  it("reports a disconnect before document delivery as a terminal failure", async () => {
    await renderPage();
    await act(async () => port.interrupt());
    expect(container.textContent).toContain("后台连接在题面到达前中断");
    expect(container.textContent).toContain("回到题目页");
  });

  it("ignores a renderer completion after the page unmounts", async () => {
    let resolveRender!: (bytes: Uint8Array) => void;
    rendererMocks.render.mockReturnValue(
      new Promise<Uint8Array>((resolve) => {
        resolveRender = resolve;
      }),
    );
    await renderPage();
    await act(async () => emitDocument());
    await act(async () => Promise.resolve());
    await act(async () => root.unmount());
    resolveRender(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    await act(async () => Promise.resolve());
    expect(container.textContent).not.toContain("PDF 已生成并下载");
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
});
