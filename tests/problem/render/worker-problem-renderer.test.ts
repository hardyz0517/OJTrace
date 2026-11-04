import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerProblemRenderer } from "../../../src/problem/render/worker-problem-renderer";
import type {
  PdfCompileRequest,
  PdfCompileResponse,
} from "../../../src/problem/render/pdf-compile-message";
import type { RenderDocument } from "../../../src/problem/domain";

const document: RenderDocument = {
  oj: "luogu",
  problemId: "P1001",
  title: "A+B",
  originalUrl: "https://www.luogu.com.cn/problem/P1001",
  ast: { type: "root" as const, children: [] },

  assets: [],
  warnings: [],
};
const pdf = () => new Uint8Array([37, 80, 68, 70, 45]).buffer;
function fakeWorker() {
  return {
    onmessage: null as
      ((event: MessageEvent<PdfCompileResponse>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn<(message: PdfCompileRequest) => void>(),
    terminate: vi.fn(),
    emit(data: PdfCompileResponse) {
      this.onmessage?.({ data } as MessageEvent<PdfCompileResponse>);
    },
  };
}
let worker: ReturnType<typeof fakeWorker>;
let create: ReturnType<typeof vi.fn<() => Worker>>;
let renderer: WorkerProblemRenderer;
beforeEach(() => {
  vi.stubGlobal("browser", {
    runtime: { getURL: (path: string) => `chrome-extension://test${path}` },
  });
  worker = fakeWorker();
  create = vi.fn(() => worker as unknown as Worker);
  renderer = new WorkerProblemRenderer(create);
});
afterEach(() => {
  renderer.dispose();
  vi.unstubAllGlobals();
});

describe("worker problem renderer", () => {
  it("routes PDF and SVG to one worker and correlates out-of-order replies", async () => {
    const first = renderer.pdf(document);
    const second = renderer.preview(document);
    expect(create).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      id: "1",
      format: "pdf",
      assetBaseUrl: "chrome-extension://test/",
      document,
    });
    worker.emit({
      id: "2",
      ok: true,
      format: "svg",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    await expect(second).resolves.toContain("<svg");
    worker.emit({
      id: "1",
      ok: true,
      format: "pdf",
      filename: "P1001-A+B.pdf",
      buffer: pdf(),
    });
    await expect(first).resolves.toEqual(new Uint8Array(pdf()));
    expect(worker.terminate).not.toHaveBeenCalled();
    renderer.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("forwards compile errors without terminating a healthy worker", async () => {
    const running = renderer.pdf(document);
    worker.emit({ id: "1", ok: false, error: "字体加载失败" });
    await expect(running).rejects.toMatchObject({ message: "字体加载失败" });
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("rejects all pending jobs after a worker crash and can create a fresh worker", async () => {
    const first = renderer.pdf(document);
    const second = renderer.preview(document);
    const all = Promise.allSettled([first, second]);
    worker.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
    expect((await all).every((result) => result.status === "rejected")).toBe(
      true,
    );
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker = fakeWorker();
    const retry = renderer.pdf(document);
    worker.emit({
      id: "3",
      ok: true,
      format: "pdf",
      filename: "P1001-A+B.pdf",
      buffer: pdf(),
    });
    await expect(retry).resolves.toBeInstanceOf(Uint8Array);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("terminates pending work on disposal and ignores stale replies", async () => {
    const running = renderer.pdf(document);
    const oldReply = worker.onmessage!;
    renderer.dispose();
    await expect(running).rejects.toThrow("已取消");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker = fakeWorker();
    const retry = renderer.preview(document);
    oldReply({
      data: { id: "1", ok: false, error: "late" },
    } as MessageEvent<PdfCompileResponse>);
    worker.emit({ id: "2", ok: true, format: "svg", svg: "<svg></svg>" });
    await expect(retry).resolves.toBe("<svg></svg>");
  });

  it.each([
    { id: "1", ok: true, format: "pdf", filename: "wrong.pdf", buffer: pdf() },
    {
      id: "1",
      ok: true,
      format: "pdf",
      filename: "P1001-A+B.pdf",
      buffer: new Uint8Array([1, 2]).buffer,
    },
    { id: "1", ok: true, format: "svg", svg: "<svg></svg>" },
  ] as PdfCompileResponse[])(
    "rejects invalid PDF results: %j",
    async (reply) => {
      const running = renderer.pdf(document);
      worker.emit(reply);
      await expect(running).rejects.toThrow("PDF 数据校验失败");
    },
  );

  it("recovers when worker construction or message serialization fails", async () => {
    create.mockImplementationOnce(() => {
      throw new Error("Worker unavailable");
    });
    await expect(renderer.pdf(document)).rejects.toThrow("Worker unavailable");
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("DataCloneError");
    });
    await expect(renderer.pdf(document)).rejects.toThrow("DataCloneError");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
