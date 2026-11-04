import type { RenderDocument } from "../domain";
import { ProblemCompileError } from "./compile-diagnostic";
import { isPdf, safeFilename } from "./pdf-file";
import { isTypstSvg } from "./typst-renderer";
import type {
  PdfCompileRequest,
  PdfCompileResponse,
} from "./pdf-compile-message";

function createRenderWorker(): Worker {
  return new Worker(new URL("./problem-render.worker.ts", import.meta.url), {
    type: "module",
    name: "ojtrace-render",
  });
}

/** A single renderer for editor previews and direct PDF downloads, outside the UI thread. */
export class WorkerProblemRenderer {
  private worker: Worker | undefined;
  private sequence = 0;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: PdfCompileResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(
    private readonly createWorker: () => Worker = createRenderWorker,
  ) {}

  async pdf(document: RenderDocument): Promise<Uint8Array> {
    const response = await this.request(document, "pdf");
    if (
      !response.ok ||
      response.format !== "pdf" ||
      response.filename !== safeFilename(document) ||
      !(response.buffer instanceof ArrayBuffer)
    )
      throw new Error("PDF 数据校验失败");
    const bytes = new Uint8Array(response.buffer);
    if (!isPdf(bytes)) throw new Error("PDF 数据校验失败");
    return bytes;
  }

  async preview(document: RenderDocument): Promise<string> {
    const response = await this.request(document, "svg");
    if (!response.ok || response.format !== "svg" || !isTypstSvg(response.svg))
      throw new Error("PDF 预览数据校验失败");
    return response.svg;
  }

  dispose(): void {
    this.fail(new Error("PDF 生成已取消，请重试。"));
  }

  private fail(error: Error): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = undefined;
    }
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private request(
    document: RenderDocument,
    format: PdfCompileRequest["format"],
  ): Promise<PdfCompileResponse> {
    this.worker ??= this.createWorker();
    const worker = this.worker;
    worker.onmessage = ({ data }: MessageEvent<PdfCompileResponse>) => {
      const pending = this.pending.get(data?.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.ok) pending.resolve(data);
      else pending.reject(new ProblemCompileError("source", data.error));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error("PDF 生成线程启动失败，请重试。"));
    };
    worker.onmessageerror = () =>
      this.fail(new Error("PDF 生成结果读取失败，请重试。"));
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({
          id,
          format,
          document,
          assetBaseUrl: browser.runtime.getURL("/"),
        } satisfies PdfCompileRequest);
      } catch (error) {
        this.fail(
          error instanceof Error
            ? error
            : new Error("无法启动 PDF 生成，请重试。"),
        );
      }
    });
  }
}
