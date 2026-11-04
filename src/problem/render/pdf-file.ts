import type { RenderDocument } from "../domain";

export function safeFilename(document: RenderDocument): string {
  const raw = `${document.problemId || "problem"}-${document.title || "statement"}`;
  const value = raw
    .split("")
    .filter(
      (character) => character >= " " && !'\\/:*?"<>|'.includes(character),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${value || "ojtrace-statement"}.pdf`;
}

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

export function pdfBlob(bytes: Uint8Array): Blob {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer], { type: "application/pdf" });
}
