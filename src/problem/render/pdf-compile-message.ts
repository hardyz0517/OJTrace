import type { RenderDocument } from "../domain";

export interface PdfCompileRequest {
  id: string;
  format: "pdf" | "svg";
  assetBaseUrl: string;
  document: RenderDocument;
}

export type PdfCompileResponse =
  | {
      id: string;
      ok: true;
      format: "pdf";
      filename: string;
      buffer: ArrayBuffer;
    }
  | { id: string; ok: true; format: "svg"; svg: string }
  | { id: string; ok: false; error: string };
