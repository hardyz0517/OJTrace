import type { RenderDocument } from "../domain";
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
    document: RenderDocument,
    options?: ProblemRenderOptions,
  ): Promise<Uint8Array>;
}

export interface TypstCompileOptions {
  readonly assets?: ReadonlyMap<string, Uint8Array>;
  readonly filename?: string;
}

export interface TypstCompiler {
  compile(source: string, options?: TypstCompileOptions): Promise<Uint8Array>;
  /** Same source and shadow files as `compile`, rendered to SVG for preview. */
  compileSvg(source: string, options?: TypstCompileOptions): Promise<string>;
}

/** Typst.ts SVG documents start with the root element, optionally after XML. */
export function isTypstSvg(value: unknown): value is string {
  return (
    typeof value === "string" && /^\s*(?:<\?xml\b[^>]*>\s*)?<svg\b/i.test(value)
  );
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

function prepareTypstDocument(document: RenderDocument): {
  document: RenderDocument;
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
 * Shares Typst source and resource preparation between PDF and SVG output.
 * Compiler injection also supports the real WASM and controlled test compilers.
 */
export class TypstProblemRenderer implements ProblemRenderer {
  constructor(private readonly compiler: TypstCompiler) {}

  render(
    document: RenderDocument,
    options: ProblemRenderOptions = {},
  ): Promise<Uint8Array> {
    const prepared = this.prepared(document, options);
    return this.compiler.compile(prepared.source, {
      assets: prepared.assets,
      filename: options.filename,
    });
  }

  /** Preview uses the PDF's Typst source. It does not build a second layout. */
  preview(
    document: RenderDocument,
    options: ProblemRenderOptions = {},
  ): Promise<string> {
    const prepared = this.prepared(document, options);
    return this.compiler.compileSvg(prepared.source, {
      assets: prepared.assets,
    });
  }

  private prepared(
    document: RenderDocument,
    options: ProblemRenderOptions,
  ): { source: string; assets: Map<string, Uint8Array> } {
    const prepared = prepareTypstDocument(document);
    for (const [path, bytes] of options.assets ?? [])
      prepared.assets.set(path, bytes);
    return {
      source: problemDocumentToTypst(prepared.document),
      assets: prepared.assets,
    };
  }
}
