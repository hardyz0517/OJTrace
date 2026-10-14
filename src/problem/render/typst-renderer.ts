import type { ProblemDocument } from "../domain";
import { IMAGE_SINGLE_BYTE_LIMIT, IMAGE_TOTAL_BYTE_LIMIT } from "../budget";
import { embeddableImageType, imageFileExtension } from "../extract/image-type";
import { problemDocumentToTypst } from "./template";

export interface ProblemRenderOptions {
  /** Optional filename hint used by browser download callers. */
  filename?: string;
  /** Optional resource map for compilers that support virtual files. */
  assets?: ReadonlyMap<string, Uint8Array>;
}

export interface ProblemRenderer {
  render(
    document: ProblemDocument,
    options?: ProblemRenderOptions,
  ): Promise<Uint8Array>;
}

export interface TypstCompiler {
  compile(
    source: string,
    options?: {
      readonly assets?: ReadonlyMap<string, Uint8Array>;
      readonly filename?: string;
    },
  ): Promise<Uint8Array>;
}

function decodeEmbeddedImage(
  dataUrl: string,
): { mimeType: string; bytes: Uint8Array } | undefined {
  const match = dataUrl.match(/^data:([^,]*);base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match || match[2] === undefined) return undefined;
  try {
    const binary = atob(match[2]);
    if (binary.length > IMAGE_SINGLE_BYTE_LIMIT) return undefined;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    const mimeType = embeddableImageType(match[1], bytes);
    return mimeType ? { mimeType, bytes } : undefined;
  } catch {
    return undefined;
  }
}

function prepareTypstDocument(document: ProblemDocument): {
  document: ProblemDocument;
  assets: Map<string, Uint8Array>;
} {
  const assets = new Map<string, Uint8Array>();
  let totalBytes = 0;
  let imageIndex = 0;
  const problemAssets = document.assets.map((asset) => {
    const embedded = asset.dataUrl
      ? decodeEmbeddedImage(asset.dataUrl)
      : undefined;
    const extension = embedded
      ? imageFileExtension(embedded.mimeType)
      : undefined;
    if (
      !embedded ||
      !extension ||
      totalBytes + embedded.bytes.byteLength > IMAGE_TOTAL_BYTE_LIMIT
    ) {
      return { ...asset, typstPath: undefined };
    }
    const path = `/ojtrace-assets/image-${imageIndex++}.${extension}`;
    totalBytes += embedded.bytes.byteLength;
    assets.set(path, embedded.bytes);
    return { ...asset, typstPath: path };
  });
  return { document: { ...document, assets: problemAssets }, assets };
}

/**
 * Adapter around typst.ts (or another WASM compiler).  The compiler is
 * injected to keep the core extension free from a hard dependency until the
 * MV3 CSP/size validation in phase 0 succeeds.
 */
export class TypstProblemRenderer implements ProblemRenderer {
  constructor(private readonly compiler: TypstCompiler) {}

  render(
    document: ProblemDocument,
    options: ProblemRenderOptions = {},
  ): Promise<Uint8Array> {
    const prepared = prepareTypstDocument(document);
    for (const [path, bytes] of options.assets ?? [])
      prepared.assets.set(path, bytes);
    return this.compiler.compile(problemDocumentToTypst(prepared.document), {
      assets: prepared.assets,
      filename: options.filename,
    });
  }
}
