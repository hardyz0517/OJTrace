import { pdfBlob } from "../../src/problem/render/pdf-file";

export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(pdfBlob(bytes));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
