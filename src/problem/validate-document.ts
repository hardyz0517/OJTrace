import type { CnoiProblem, RenderDocument } from "./domain";
import { isSourceId } from "../domain/types";
import { PROBLEM_DOCUMENT_LIMIT, PROBLEM_MARKDOWN_LIMIT } from "./budget";
import { readProblemMarkdown } from "./problem-markdown";

function bounded(value: unknown): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      PROBLEM_DOCUMENT_LIMIT
    );
  } catch {
    return false;
  }
}
function resources(value: {
  assets?: unknown;
  warnings?: unknown;
  language?: unknown;
}): boolean {
  return (
    (value.language === undefined ||
      ["zh", "en", "ja", "other"].includes(String(value.language))) &&
    Array.isArray(value.assets) &&
    value.assets.every(
      (asset) =>
        asset &&
        typeof asset === "object" &&
        typeof asset.sourceUrl === "string" &&
        ["alt", "dataUrl", "mimeType", "typstPath"].every(
          (key) => asset[key] === undefined || typeof asset[key] === "string",
        ) &&
        ["width", "height"].every(
          (key) =>
            asset[key] === undefined ||
            (typeof asset[key] === "number" &&
              Number.isFinite(asset[key]) &&
              asset[key] > 0),
        ),
    ) &&
    Array.isArray(value.warnings) &&
    value.warnings.every(
      (warning) =>
        warning &&
        typeof warning === "object" &&
        typeof warning.code === "string" &&
        typeof warning.message === "string",
    )
  );
}
export function isRenderDocument(value: unknown): value is RenderDocument {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RenderDocument>;
  return (
    isSourceId(item.oj) &&
    typeof item.problemId === "string" &&
    typeof item.title === "string" &&
    typeof item.originalUrl === "string" &&
    item.ast?.type === "root" &&
    Array.isArray(item.ast.children) &&
    resources(item) &&
    validLabels(item.displayLabels) &&
    bounded(value)
  );
}
/** Separate contract from the worker's parsed-document protocol. */
export function isCnoiProblem(value: unknown): value is CnoiProblem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CnoiProblem>;
  if (
    typeof item.cnoiMarkdown !== "string" ||
    item.cnoiMarkdown.length === 0 ||
    item.cnoiMarkdown.length > PROBLEM_MARKDOWN_LIMIT ||
    !resources(item) ||
    !bounded(value) ||
    new TextEncoder().encode(item.cnoiMarkdown).byteLength >
      PROBLEM_MARKDOWN_LIMIT
  )
    return false;
  const header = readProblemMarkdown(item.cnoiMarkdown);
  return header.ok && header.value.body.trim().length > 0;
}

function validLabels(labels: RenderDocument["displayLabels"]): boolean {
  if (labels === undefined) return true;
  if (
    !labels ||
    typeof labels !== "object" ||
    typeof labels.timeLimit !== "string" ||
    typeof labels.memoryLimit !== "string"
  )
    return false;
  const page = labels.page;
  return (
    page === undefined ||
    (page !== null &&
      typeof page === "object" &&
      typeof page.prefix === "string" &&
      typeof page.suffix === "string" &&
      typeof page.totalPrefix === "string" &&
      typeof page.totalSuffix === "string")
  );
}
