import type { RenderDocument } from "../../problem/domain";
import { isRenderDocument } from "../../problem/validate-document";

export const PDF_WORKER_TARGET = "ojtrace:pdf-worker";
export const PDF_WORKER_ALIVE = "ojtrace:pdf-worker:alive";
export const PDF_WORKER_PATH = "/pdf-worker.html";
export const DIRECT_PDF_TIMEOUT_MS = 90_000;

export type PdfWorkerRequest =
  | {
      target: typeof PDF_WORKER_TARGET;
      type: "render";
      id: string;
      document: RenderDocument;
    }
  | { target: typeof PDF_WORKER_TARGET; type: "release"; id: string };

export type PdfWorkerResponse =
  { ok: true; url: string; filename: string } | { ok: false; error: string };

export function isPdfWorkerTarget(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { target?: unknown }).target === PDF_WORKER_TARGET
  );
}

export function isPdfWorkerRequest(value: unknown): value is PdfWorkerRequest {
  if (!isPdfWorkerTarget(value)) return false;
  const item = value as Partial<PdfWorkerRequest>;
  return (
    typeof item.id === "string" &&
    item.id.length >= 12 &&
    item.id.length <= 128 &&
    (item.type === "release" ||
      (item.type === "render" && isRenderDocument(item.document)))
  );
}
