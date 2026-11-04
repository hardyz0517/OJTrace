import type { RenderDocument } from "../../problem/domain";
import { safeFilename } from "../../problem/render/pdf-file";
import {
  DIRECT_PDF_TIMEOUT_MS,
  PDF_WORKER_PATH,
  PDF_WORKER_TARGET,
  type PdfWorkerRequest,
  type PdfWorkerResponse,
} from "./pdf-worker-messages";

/** Background orchestration only; the WASM compiler stays in the offscreen entrypoint. */
export class DirectProblemDownload {
  private active = false;

  async run(
    id: string,
    loadDocument: (signal: AbortSignal) => Promise<RenderDocument>,
  ): Promise<void> {
    if (this.active) throw new Error("已有 PDF 导出任务正在进行，请稍后重试。");
    this.active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ownsOffscreen = false;
    let completed = false;
    try {
      const workerUrl = browser.runtime.getURL(PDF_WORKER_PATH);
      const contexts = await browser.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [workerUrl],
      });
      if (!contexts.length) {
        await browser.offscreen.createDocument({
          url: PDF_WORKER_PATH,
          reasons: ["BLOBS", "WORKERS"],
          justification: "在本地生成题面 PDF 并提供下载文件，无需打开标签页。",
        });
      }
      ownsOffscreen = true;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("PDF 导出超时，请重试。"));
        }, DIRECT_PDF_TIMEOUT_MS);
      });
      const task = async () => {
        const document = await loadDocument(controller.signal);
        controller.signal.throwIfAborted();
        const request: PdfWorkerRequest = {
          target: PDF_WORKER_TARGET,
          type: "render",
          id,
          document,
        };
        const response: PdfWorkerResponse | undefined =
          await browser.runtime.sendMessage(request);
        controller.signal.throwIfAborted();
        if (!response || typeof response.ok !== "boolean")
          throw new Error("PDF 生成服务未响应，请重试。");
        if (!response.ok)
          throw new Error(response.error || "PDF 生成失败，请重试。");
        if (
          typeof response.url !== "string" ||
          !response.url.startsWith(`blob:${browser.runtime.getURL("/")}`) ||
          response.filename !== safeFilename(document)
        )
          throw new Error("PDF 下载数据无效，请重试。");
        await downloadFile(response.url, response.filename, controller.signal);
      };
      await Promise.race([task(), expired]);
      completed = true;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
      if (ownsOffscreen) {
        const release: PdfWorkerRequest = {
          target: PDF_WORKER_TARGET,
          type: "release",
          id,
        };
        if (completed)
          await browser.runtime.sendMessage(release).catch(() => {});
        await browser.offscreen.closeDocument().catch(() => {});
      }
      this.active = false;
    }
  }
}

async function downloadFile(
  url: string,
  filename: string,
  signal: AbortSignal,
): Promise<void> {
  let downloadId: number | undefined;
  let settled = false;
  let resolveDone: () => void = () => {};
  let rejectDone: (reason: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const finish = (state: string | undefined, error?: string) => {
    if (settled) return;
    if (state === "complete") {
      settled = true;
      resolveDone();
    } else if (state === "interrupted") {
      settled = true;
      rejectDone(
        new Error(`PDF 下载未完成，请重试。${error ? `（${error}）` : ""}`),
      );
    }
  };
  const onChanged = (delta: {
    id: number;
    state?: { current?: string };
    error?: { current?: string };
  }) => {
    if (delta.id === downloadId)
      finish(delta.state?.current, delta.error?.current);
  };
  const onAbort = () => {
    if (settled) return;
    settled = true;
    if (downloadId !== undefined)
      void browser.downloads.cancel(downloadId).catch(() => {});
    rejectDone(new Error("PDF 下载已取消，请重试。"));
  };
  browser.downloads.onChanged.addListener(onChanged);
  signal.addEventListener("abort", onAbort, { once: true });
  // Attach the completion consumer before starting the download, so a fast
  // interruption/abort never leaves an unhandled rejection.
  void done.catch(() => {});
  try {
    signal.throwIfAborted();
    downloadId = await browser.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: "uniquify",
    });
    if (signal.aborted) {
      await browser.downloads.cancel(downloadId).catch(() => {});
      signal.throwIfAborted();
    }
    // It may already have completed before download() returned its id.
    const [item] = await browser.downloads.search({ id: downloadId });
    finish(item?.state, item?.error);
    await done;
  } finally {
    browser.downloads.onChanged.removeListener(onChanged);
    signal.removeEventListener("abort", onAbort);
  }
}
