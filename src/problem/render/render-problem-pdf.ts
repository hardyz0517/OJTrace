import type { RenderDocument } from "../domain";
import type { TypstCompiler } from "./typst-renderer";
import { TypstProblemRenderer } from "./typst-renderer";

export function renderProblemPdf(
  document: RenderDocument,
  compiler: TypstCompiler,
  filename?: string,
): Promise<Uint8Array> {
  return new TypstProblemRenderer(compiler).render(
    document,
    filename ? { filename } : {},
  );
}

/** Same renderer and Typst source as `renderProblemPdf`, in the preview format. */
export function renderProblemPreview(
  document: RenderDocument,
  compiler: TypstCompiler,
): Promise<string> {
  return new TypstProblemRenderer(compiler).preview(document);
}
