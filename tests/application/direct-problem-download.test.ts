import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectProblemDownload } from "../../src/application/problem-export/direct-download";
import { DIRECT_PDF_TIMEOUT_MS } from "../../src/application/problem-export/pdf-worker-messages";
import type { RenderDocument } from "../../src/problem/domain";

const document: RenderDocument = {
  oj: "luogu",
  problemId: "P1001",
  title: "A+B",
  originalUrl: "https://www.luogu.com.cn/problem/P1001",
  ast: {
    type: "root" as const,
    children: [
      { type: "paragraph", children: [{ type: "text", value: "求和" }] },
    ],
  },

  assets: [],
  warnings: [],
};
const id = "0123456789abcdef";
const pdf = {
  ok: true,
  url: "blob:chrome-extension://test/pdf",
  filename: "P1001-A+B.pdf",
};
type Delta = {
  id: number;
  state?: { current: string };
  error?: { current: string };
};
let listeners: Set<(delta: Delta) => void>;
const browserMock = {
  runtime: {
    getURL: (path: string) => `chrome-extension://test${path}`,
    getContexts: vi.fn(async (): Promise<unknown[]> => []),
    sendMessage: vi.fn(async (message: { type: string }): Promise<unknown> =>
      message.type === "render" ? pdf : { ok: true },
    ),
  },
  offscreen: {
    createDocument: vi.fn(async () => {}),
    closeDocument: vi.fn(async () => {}),
  },
  downloads: {
    download: vi.fn(async () => 42),
    search: vi.fn(
      async (): Promise<Array<{ state: string; error?: string }>> => [
        { state: "complete" },
      ],
    ),
    cancel: vi.fn(async () => {}),
    onChanged: {
      addListener: vi.fn((listener: (delta: Delta) => void) => {
        listeners.add(listener);
      }),
      removeListener: vi.fn((listener: (delta: Delta) => void) => {
        listeners.delete(listener);
      }),
    },
  },
  tabs: { create: vi.fn() },
};
const load = vi.fn(async () => document);
beforeEach(() => {
  vi.resetAllMocks();
  listeners = new Set();
  vi.stubGlobal("browser", browserMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("direct PDF download lifecycle", () => {
  it("starts offscreen before capture and aborts the same capture scope on timeout", async () => {
    vi.useFakeTimers();
    let captureSignal: AbortSignal | undefined;
    const result = new DirectProblemDownload()
      .run(id, async (signal) => {
        expect(browserMock.offscreen.createDocument).toHaveBeenCalledOnce();
        captureSignal = signal;
        return new Promise<RenderDocument>((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("capture aborted")),
            { once: true },
          ),
        );
      })
      .catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(DIRECT_PDF_TIMEOUT_MS);
    expect(captureSignal?.aborted).toBe(true);
    expect(await result).toBeInstanceOf(Error);
    expect(browserMock.runtime.sendMessage).not.toHaveBeenCalled();
    expect(browserMock.downloads.download).not.toHaveBeenCalled();
  });
  it("keeps the offscreen Blob alive until downloads confirms completion and never opens a tab", async () => {
    browserMock.downloads.search.mockResolvedValueOnce([
      { state: "in_progress" },
    ]);
    const running = new DirectProblemDownload().run(id, load);
    await vi.waitFor(() =>
      expect(browserMock.downloads.search).toHaveBeenCalled(),
    );
    expect(browserMock.offscreen.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/pdf-worker.html",
        reasons: ["BLOBS", "WORKERS"],
      }),
    );
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "render", id, document }),
    );
    expect(browserMock.offscreen.closeDocument).not.toHaveBeenCalled();
    expect(browserMock.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "release" }),
    );
    for (const listener of listeners)
      listener({ id: 999, state: { current: "complete" } });
    expect(browserMock.offscreen.closeDocument).not.toHaveBeenCalled();
    for (const listener of listeners)
      listener({ id: 42, state: { current: "complete" } });
    await running;
    expect(browserMock.downloads.download).toHaveBeenCalledWith({
      url: pdf.url,
      filename: pdf.filename,
      saveAs: false,
      conflictAction: "uniquify",
    });
    expect(browserMock.runtime.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "release", id }),
    );
    expect(browserMock.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(browserMock.tabs.create).not.toHaveBeenCalled();
  });

  it("handles a download that completes before download() returns its id", async () => {
    await new DirectProblemDownload().run(id, load);
    expect(browserMock.downloads.search).toHaveBeenCalledWith({ id: 42 });
    expect(browserMock.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("reports download interruption and cleans up the worker and listeners", async () => {
    browserMock.downloads.search.mockResolvedValueOnce([
      { state: "interrupted", error: "USER_CANCELED" },
    ]);
    await expect(new DirectProblemDownload().run(id, load)).rejects.toThrow(
      "PDF 下载未完成",
    );
    expect(browserMock.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("rejects concurrent exports and can retry after startup failure", async () => {
    const runner = new DirectProblemDownload();
    let resolveLoad!: (document: RenderDocument) => void;
    const running = runner.run(
      id,
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    await vi.waitFor(() => expect(resolveLoad).toBeDefined());
    await expect(runner.run("different-token", load)).rejects.toThrow(
      "已有 PDF",
    );
    expect(browserMock.offscreen.closeDocument).not.toHaveBeenCalled();
    resolveLoad(document);
    await running;
    browserMock.offscreen.createDocument.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    await expect(runner.run(id, load)).rejects.toThrow("unavailable");
    await runner.run(id, load);
    expect(browserMock.downloads.download).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ok: false, error: "字体未能加载" },
    undefined,
    { ...pdf, url: "https://untrusted.example/file.pdf" },
    { ...pdf, filename: "../wrong.pdf" },
  ])("does not download invalid/failed compiler replies: %j", async (reply) => {
    browserMock.runtime.sendMessage.mockResolvedValueOnce(reply);
    await expect(new DirectProblemDownload().run(id, load)).rejects.toThrow();
    expect(browserMock.downloads.download).not.toHaveBeenCalled();
    expect(browserMock.offscreen.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("times out a hung compiler, closes it without waiting for a reply, and ignores a late result", async () => {
    vi.useFakeTimers();
    let resolveRender!: (value: unknown) => void;
    browserMock.runtime.sendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRender = resolve;
        }),
    );
    const runner = new DirectProblemDownload();
    const outcome = runner.run(id, load).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(DIRECT_PDF_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ message: "PDF 导出超时，请重试。" });
    expect(browserMock.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    resolveRender(pdf);
    await Promise.resolve();
    expect(browserMock.downloads.download).not.toHaveBeenCalled();
    await runner.run(id, load);
    expect(browserMock.downloads.download).toHaveBeenCalledTimes(1);
  });

  it("does not submit a late capture result after timeout", async () => {
    vi.useFakeTimers();
    let resolveLoad!: (value: RenderDocument) => void;
    const outcome = new DirectProblemDownload()
      .run(
        id,
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      )
      .catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(DIRECT_PDF_TIMEOUT_MS);
    expect(await outcome).toBeInstanceOf(Error);
    resolveLoad(document);
    await Promise.resolve();
    expect(browserMock.runtime.sendMessage).not.toHaveBeenCalled();
    expect(browserMock.downloads.download).not.toHaveBeenCalled();
  });

  it("cancels an unfinished download when the overall deadline expires", async () => {
    vi.useFakeTimers();
    browserMock.downloads.search.mockResolvedValueOnce([
      { state: "in_progress" },
    ]);
    const outcome = new DirectProblemDownload()
      .run(id, load)
      .catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(DIRECT_PDF_TIMEOUT_MS);
    expect(await outcome).toBeInstanceOf(Error);
    expect(browserMock.downloads.cancel).toHaveBeenCalledWith(42);
    expect(browserMock.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("cleans up when downloads rejects the initial handoff", async () => {
    browserMock.downloads.download.mockRejectedValueOnce(
      new Error("downloads denied"),
    );
    await expect(new DirectProblemDownload().run(id, load)).rejects.toThrow(
      "downloads denied",
    );
    expect(browserMock.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});
