import { BrowserTypstCompiler } from "./browser-typst-compiler";
import { compileDiagnostic } from "./compile-diagnostic";
import { renderProblemPdf, renderProblemPreview } from "./render-problem-pdf";
import { isPdf, safeFilename } from "./pdf-file";
import type {
  PdfCompileRequest,
  PdfCompileResponse,
} from "./pdf-compile-message";

const scope = self as unknown as {
  onmessage: (event: MessageEvent<PdfCompileRequest>) => void;
  postMessage(message: PdfCompileResponse, transfer?: Transferable[]): void;
};

// The bundled Typst entrypoint publishes its WASM handles through `window`.
// Point that name at this worker's global object before its lazy import. No
// DOM APIs or extension APIs are used by the compile path.
Object.defineProperty(self, "window", { value: self, configurable: true });

// Fonts, WASM initialization, layout and PDF serialization all run here. This
// worker has no extension APIs; its owner provides the local asset base URL.
scope.onmessage = async ({ data }) => {
  try {
    const compiler = new BrowserTypstCompiler(undefined, data.assetBaseUrl);
    if (data.format === "svg") {
      const svg = await renderProblemPreview(data.document, compiler);
      scope.postMessage({ id: data.id, ok: true, format: "svg", svg });
      return;
    }
    const filename = safeFilename(data.document);
    const bytes = await renderProblemPdf(data.document, compiler, filename);
    if (!isPdf(bytes)) throw new Error("PDF 数据校验失败");
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    scope.postMessage(
      { id: data.id, ok: true, format: "pdf", filename, buffer },
      [buffer],
    );
  } catch (error) {
    scope.postMessage({
      id: data.id,
      ok: false,
      error: compileDiagnostic(error),
    });
  }
};
