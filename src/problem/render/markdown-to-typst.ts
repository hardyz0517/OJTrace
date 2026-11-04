import type { ProblemAsset } from "../domain";
import type {
  ImageFrame,
  InlineNode,
  MarkdownBlock,
  TableBlock,
  TableCellSpan,
  TableColumnAlign,
} from "../markdown/ast";
import { problemRenderStyle } from "./style-tokens";
import { escapeTypstContent, typstStringLiteral } from "./typst-escape";

/** LaTeX stays inside a Typst string so `#mi` parses it and markup cannot. */
function mitex(value: string, block: boolean): string {
  return `#mi(block: ${block ? "true" : "false"}, ${typstStringLiteral(value)})`;
}

function rawLanguage(language: string | undefined): string {
  const trimmed = language?.trim() ?? "";
  if (!trimmed || trimmed === "plain" || trimmed === "text") return "txt";
  if (trimmed === "markdown") return "md";
  return trimmed;
}

function typstText(value: string): string {
  return value
    .split("\n")
    .map((line) => escapeTypstContent(line))
    .join("\\");
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function lengthPt(value: number): string {
  return `${formatNumber(value)}pt`;
}

const CSS_PX_PT = 72 / 96;

function authorImageLength(value: number | undefined): string | undefined {
  const pixels = positiveNumber(value);
  return pixels === undefined ? undefined : lengthPt(pixels * CSS_PX_PT);
}

/**
 * Natural image size, capped by the column. Width and height are passed only
 * when the statement itself set them. Zoom and max-width stay out of Typst:
 * the current visual contract does not scale those images.
 */
function authorImageWidth(frame: ImageFrame): string | undefined {
  const ratio = positiveNumber(frame.widthRatio);
  if (ratio !== undefined) return `${formatNumber(ratio * 100)}%`;
  return authorImageLength(frame.width);
}

function boxedImage(path: string, alt: string, frame: ImageFrame): string {
  const options: string[] = [];
  const width = authorImageWidth(frame);
  const height = authorImageLength(frame.height);
  if (width) options.push(`width: ${width}`);
  if (height) options.push(`height: ${height}`);
  if (alt) options.push(`alt: ${typstStringLiteral(alt)}`);
  const suffix = options.length > 0 ? `, ${options.join(", ")}` : "";
  return `#box(image(${typstStringLiteral(path)}${suffix}))`;
}

function typstImage(
  sourceUrl: string,
  alt: string,
  assets: readonly ProblemAsset[],
  frame: ImageFrame,
): string {
  const asset = assets.find((item) => item.sourceUrl === sourceUrl);
  if (asset?.dataUrl && asset.typstPath)
    return boxedImage(asset.typstPath, alt, frame);
  if (/^https?:\/\//i.test(sourceUrl))
    return `#link(${typstStringLiteral(sourceUrl)})[${typstText(alt || sourceUrl)} ↗]`;
  return `#emph[${typstText(alt || sourceUrl)}]`;
}

function unsupported(node: never): never {
  throw new Error(`Unsupported statement node: ${JSON.stringify(node)}`);
}

function inlineNode(node: InlineNode, assets: readonly ProblemAsset[]): string {
  switch (node.type) {
    case "text":
      return typstText(node.value);
    case "strong":
      return `*${inlineNodes(node.children, assets)}*`;
    case "delete":
      return `#strike[${inlineNodes(node.children, assets)}]`;
    case "emphasis":
      return `_${inlineNodes(node.children, assets)}_`;
    case "link":
      return `#link(${typstStringLiteral(node.url)})[${inlineNodes(node.children, assets)}]`;
    case "inline-code":
      return `#raw(${typstStringLiteral(node.value)}, lang: "txt", block: false)`;
    case "inline-math":
      return mitex(node.value, node.display === true);
    case "image-inline":
      return typstImage(node.url, node.alt, assets, node);
    case "break":
      return "\\";
    default:
      return unsupported(node);
  }
}

function inlineNodes(
  nodes: readonly InlineNode[],
  assets: readonly ProblemAsset[] = [],
): string {
  return nodes.map((node) => inlineNode(node, assets)).join("");
}

function heading(
  block: Extract<MarkdownBlock, { type: "heading" }>,
  assets: readonly ProblemAsset[],
): string {
  const level = Math.min(6, Math.max(1, block.level || 2));
  return `=${"=".repeat(level - 1)} ${inlineNodes(block.children, assets)}`;
}

function paragraph(
  block: Extract<MarkdownBlock, { type: "paragraph" }>,
  assets: readonly ProblemAsset[],
): string {
  const content = inlineNodes(block.children, assets);
  if (block.caption === true && content)
    return `#text(size: ${problemRenderStyle.caption.sizePt}pt)[${content}]`;
  return content;
}

function codeLineMarkup(
  line: readonly InlineNode[],
  assets: readonly ProblemAsset[],
): string {
  if (line.length === 0) return "[]";
  const content = line
    .map((node) => {
      switch (node.type) {
        case "inline-math":
          return mitex(node.value === "..." ? "\\ldots" : node.value, false);
        case "text":
        case "inline-code":
          return typstText(node.value);
        case "break":
          return " ";
        case "strong":
        case "delete":
        case "emphasis":
        case "link":
        case "image-inline":
          return inlineNode(node, assets);
        default:
          return unsupported(node);
      }
    })
    .join("");
  return `[${content}]`;
}

function code(
  block: Extract<MarkdownBlock, { type: "code" }>,
  assets: readonly ProblemAsset[],
): string {
  const lines = block.lines;
  const mathLines =
    lines?.some((line) => line.some((node) => node.type === "inline-math")) ??
    false;
  if (lines && mathLines)
    return `#oj-sample-lines((${lines.map((line) => codeLineMarkup(line, assets)).join(", ")}${lines.length === 1 ? "," : ""}))`;
  const language = rawLanguage(block.language);
  return `#raw(${typstStringLiteral(block.value)}, block: true, lang: ${typstStringLiteral(language)})`;
}

function list(
  block: Extract<MarkdownBlock, { type: "list" }>,
  assets: readonly ProblemAsset[],
): string {
  const bodyFor = (item: (typeof block.items)[number]) =>
    `${item.checked != null ? typstText(`[${item.checked ? "x" : " "}] `) : ""}${markdownBlocksToTypst(item.children, assets)}`;
  if (block.ordered && block.start != null && block.start !== 1)
    return `#enum(start: ${block.start}, ${block.items.map((item) => `[${bodyFor(item)}]`).join(", ")})`;
  const marker = block.ordered ? "+" : "-";
  return block.items
    .map((item) => {
      const body = bodyFor(item);
      const lines = body.split("\n");
      const first = lines[0] ?? "";
      const rest = lines
        .slice(1)
        .map((line) => (line.length > 0 ? `  ${line}` : line))
        .join("\n");
      return rest.length > 0
        ? `${marker} ${first}\n${rest}`
        : `${marker} ${first}`;
    })
    .join("\n");
}

function cellSpan(
  spans: TableBlock["spans"],
  rowIndex: number,
  cellIndex: number,
): TableCellSpan | null {
  if (!spans) return { colspan: 1, rowspan: 1 };
  const row = spans[rowIndex];
  if (!row || cellIndex >= row.length) return { colspan: 1, rowspan: 1 };
  const span = row[cellIndex];
  if (span == null) return null;
  return {
    colspan: Math.max(1, span.colspan || 1),
    rowspan: Math.max(1, span.rowspan || 1),
  };
}

function rowWidth(
  spans: TableBlock["spans"],
  values: readonly unknown[],
  rowIndex: number,
): number {
  return values.reduce<number>((width, _cell, cellIndex) => {
    const span = cellSpan(spans, rowIndex, cellIndex);
    return span ? width + span.colspan : width;
  }, 0);
}

function typstCell(content: string, span: TableCellSpan): string {
  if (span.colspan === 1 && span.rowspan === 1) return `[${content}]`;
  const options = [
    span.colspan > 1 ? `colspan: ${span.colspan}` : "",
    span.rowspan > 1 ? `rowspan: ${span.rowspan}` : "",
  ].filter(Boolean);
  return `table.cell(${options.join(", ")})[${content}]`;
}

function columnAlignments(
  value: readonly (TableColumnAlign | null)[] | undefined,
  columns: number,
): string[] {
  return Array.from({ length: columns }, (_, index) => {
    const horizontal = value?.[index];
    const side =
      horizontal === "left" || horizontal === "right" ? horizontal : "center";
    return `${side} + horizon`;
  });
}

function table(
  block: Extract<MarkdownBlock, { type: "table" }>,
  assets: readonly ProblemAsset[],
): string {
  const headerCount = block.headers.length > 0 ? 1 : 0;
  const columns = Math.max(
    1,
    block.headers.length > 0 ? rowWidth(block.spans, block.headers, 0) : 0,
    ...block.rows.map((row, rowIndex) =>
      rowWidth(block.spans, row, headerCount + rowIndex),
    ),
  );
  const emitRow = (
    values: readonly (readonly InlineNode[])[],
    rowIndex: number,
  ): string[] =>
    values.flatMap((cell, cellIndex) => {
      const span = cellSpan(block.spans, rowIndex, cellIndex);
      if (!span) return [];
      return [typstCell(inlineNodes(cell, assets), span)];
    });
  const cells = [
    ...emitRow(block.headers, 0),
    ...block.rows.flatMap((row, rowIndex) =>
      emitRow(row, headerCount + rowIndex),
    ),
  ];
  const fields = cells.length > 0 ? `, ${cells.join(", ")}` : "";
  const alignments = columnAlignments(block.alignments, columns);
  return `#figure(table(columns: ${columns}, align: (${alignments.join(", ")})${fields}))`;
}

function blockToTypst(
  block: MarkdownBlock,
  assets: readonly ProblemAsset[],
): string {
  switch (block.type) {
    case "heading":
      return heading(block, assets);
    case "paragraph":
      return paragraph(block, assets);
    case "math":
      return mitex(block.value, true);
    case "code":
      return code(block, assets);
    case "list":
      return list(block, assets);
    case "table":
      return table(block, assets);
    case "align": {
      const inner = markdownBlocksToTypst(block.blocks, assets);
      return `#align(${block.align})[#set par(first-line-indent: 0pt)\n${inner}]`;
    }
    case "image":
      return typstImage(block.url, block.alt, assets, block);
    case "figure": {
      const inner = markdownBlocksToTypst(block.blocks, assets);
      const captionArg = block.caption
        ? `caption: ${typstStringLiteral(block.caption)}, `
        : "";
      return `#figure(${captionArg})[\n${inner}\n]`;
    }
    case "quote":
      return `#quote(block: true)[${markdownBlocksToTypst(block.blocks, assets)}]`;
    case "thematic-break":
      return "#thematic-break";
    default:
      return unsupported(block);
  }
}

/** Convert the canonical statement AST to a controlled Typst content body. */
export function markdownBlocksToTypst(
  blocks: readonly MarkdownBlock[],
  assets: readonly ProblemAsset[] = [],
): string {
  return blocks
    .map((block) => blockToTypst(block, assets))
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}
