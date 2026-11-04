import type { CnoiRuleOverrides } from "../../domain/cnoi-rules";
import type { CnoiProblem, SourceProblem } from "../domain";
import { parseMarkdown } from "../markdown/parse";
import { serializeMarkdown } from "../markdown/serialize";
import { serializeProblemMarkdown } from "../problem-markdown";
import { transformToCnoi } from "./transform";

/** The single complete Source Markdown → CNOI Markdown conversion use case. */
export function convertSourceToCnoi(
  source: SourceProblem,
  overrides: CnoiRuleOverrides = {},
): { ok: true; value: CnoiProblem } | { ok: false; message: string } {
  try {
    const parsed = parseMarkdown(source.sourceMarkdown, {
      baseUrl: source.metadata.originalUrl,
    });
    const transformed = transformToCnoi(parsed.ast, source.metadata, overrides);
    if (!transformed.ast.children.length)
      return { ok: false, message: "题面正文为空。" };
    return {
      ok: true,
      value: {
        cnoiMarkdown: serializeProblemMarkdown(
          source.metadata,
          serializeMarkdown(transformed.ast.children),
        ),
        assets: source.assets,
        warnings: [
          ...source.warnings,
          ...parsed.warnings,
          ...transformed.warnings,
        ],
      },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "题面 Markdown 无法完整转换。",
    };
  }
}
