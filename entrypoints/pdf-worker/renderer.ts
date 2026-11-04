import type { RenderDocument } from "../../src/problem/domain";
import { compileDiagnostic } from "../../src/problem/render/compile-diagnostic";
import {
  isPdf,
  pdfBlob,
  safeFilename,
} from "../../src/problem/render/pdf-file";
import type { PdfWorkerResponse } from "../../src/application/problem-export/pdf-worker-messages";
import { WorkerProblemRenderer } from "../../src/problem/render/worker-problem-renderer";

/** Owns the download Blob; CPU-intensive rendering lives in a dedicated worker. */
export class OffscreenPdfRenderer {
  private readonly urls = new Map<string, string>();
  private busy = false;

  constructor(
    private readonly renderer: Pick<
      WorkerProblemRenderer,
      "pdf" | "dispose"
    > = new WorkerProblemRenderer(),
  ) {}

  async render(
    id: string,
    document: RenderDocument,
  ): Promise<PdfWorkerResponse> {
    if (this.busy || this.urls.size)
      return { ok: false, error: "已有 PDF 导出任务正在进行，请稍后重试。" };
    this.busy = true;
    try {
      const bytes = await this.renderer.pdf(document);
      const filename = safeFilename(document);
      if (!isPdf(bytes)) throw new Error("PDF 数据校验失败");
      const url = URL.createObjectURL(pdfBlob(bytes));
      this.urls.set(id, url);
      return { ok: true, url, filename };
    } catch (error) {
      return { ok: false, error: compileDiagnostic(error) };
    } finally {
      this.renderer.dispose();
      this.busy = false;
    }
  }

  release(id: string): void {
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
  }

  dispose(): void {
    this.renderer.dispose();
    for (const id of this.urls.keys()) this.release(id);
  }
}
