import type {
  RenderDocument,
  SourceProblem,
  ProblemPageSnapshot,
} from "../../src/problem/domain";
import { problemAdapterRegistry } from "../../src/problem/registry";
import { convertSourceToCnoi } from "../../src/problem/cnoi/convert";
import { parseProblemMarkdown } from "../../src/problem/problem-markdown";
import { serializeMarkdown } from "../../src/problem/markdown/serialize";
import { parseMarkdown } from "../../src/problem/markdown/parse";
import type { MarkdownBlock } from "../../src/problem/markdown/ast";

/** Inspect only the syntax parsed from the public source text. */
export function sourceNodes(source: SourceProblem): readonly MarkdownBlock[] {
  const result: MarkdownBlock[] = [];
  const visit = (nodes: readonly MarkdownBlock[]) => {
    for (const node of nodes) {
      result.push(node);
      if ("blocks" in node) visit(node.blocks);
      if (node.type === "list")
        node.items.forEach((item) => visit(item.children));
    }
  };
  visit(
    parseMarkdown(source.sourceMarkdown, {
      baseUrl: source.metadata.originalUrl,
    }).ast.children,
  );
  return result;
}

/** Test fixture conversion: exactly one text body, with no parallel semantic input. */
export function sourceFixture(document: RenderDocument): SourceProblem {
  const { ast, assets, warnings, displayLabels, ...metadata } = document;
  void displayLabels;
  return {
    metadata,
    sourceMarkdown: serializeMarkdown(ast.children),
    assets,
    warnings,
  };
}
export function cnoiFixture(document: RenderDocument) {
  const result = convertSourceToCnoi(sourceFixture(document));
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
export async function extractRenderedDocument(snapshot: ProblemPageSnapshot) {
  const extracted = await problemAdapterRegistry.extractSource(snapshot);
  if (!extracted.ok) throw new Error(extracted.message ?? extracted.reason);
  const prepared = convertSourceToCnoi(extracted.source);
  if (!prepared.ok) throw new Error(prepared.message);
  const parsed = parseProblemMarkdown(
    prepared.value.cnoiMarkdown,
    prepared.value,
  );
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}
