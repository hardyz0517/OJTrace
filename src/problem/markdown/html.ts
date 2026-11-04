import { TABLE_CELL_LIMIT, TABLE_SPAN_LIMIT } from "../budget";
import type { ProblemWarning } from "../domain";
import {
  attr,
  findAll,
  hasClass,
  parseHtmlDocument,
  trimmedText,
  type HtmlElementNode,
  type HtmlNode,
} from "../extract/html-document";
import { resolveResourceUrl } from "../extract/resource-url";
import { plainCodeMath } from "./math-code";
import type {
  ImageFrame,
  InlineNode,
  MarkdownBlock,
  TableBlock,
  TableColumnAlign,
  CodeBlock,
  ListBlock,
} from "./ast";

export interface HtmlExtraction {
  blocks: readonly MarkdownBlock[];
  warnings: readonly ProblemWarning[];
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "fieldset",
  "figure",
  "figcaption",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

const SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);
export function htmlToAst(rootHtml: string, baseUrl: string): HtmlExtraction {
  const root = parseHtmlDocument(rootHtml);
  const warnings: ProblemWarning[] = [];
  const blocks = extractBlocks(root.children, baseUrl, warnings);
  return {
    blocks,
    warnings,
  };
}

function extractBlocks(
  nodes: readonly HtmlNode[],
  baseUrl: string,
  warnings: ProblemWarning[],
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const pending: HtmlNode[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const inline = inlineNodes(
      {
        type: "element",
        tagName: "p",
        attrs: {},
        children: pending.splice(0),
      },
      baseUrl,
      warnings,
    );
    blocks.push(...paragraphsFromInline(inline));
  };
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.value.trim() || pending.length > 0) pending.push(node);
      continue;
    }
    if (SKIP_TAGS.has(node.tagName) && !isMathSourceScript(node)) continue;
    if (isMathVisualDuplicate(node)) continue;
    if (isInlineFlowElement(node)) {
      pending.push(node);
      continue;
    }
    flush();
    const block = extractBlock(node, baseUrl, warnings);
    if (block) blocks.push(...block);
    else if (node.children.length > 0)
      blocks.push(...extractBlocks(node.children, baseUrl, warnings));
  }
  flush();
  return blocks;
}

function extractBlock(
  node: HtmlElementNode,
  baseUrl: string,
  warnings: ProblemWarning[],
): MarkdownBlock[] | undefined {
  const tag = node.tagName;
  const declaredAlign = attr(node, "data-ojtrace-align");
  if (declaredAlign === "center" || declaredAlign === "right")
    return [
      {
        type: "align",
        align: declaredAlign,
        blocks: extractBlocks(node.children, baseUrl, warnings),
      },
    ];
  if (attr(node, "data-ojtrace-figure") === "true")
    return [
      {
        type: "figure",
        ...(attr(node, "data-caption") != null
          ? { caption: attr(node, "data-caption") }
          : {}),
        blocks: extractBlocks(node.children, baseUrl, warnings),
      },
    ];
  if (/^h[1-6]$/.test(tag)) {
    const text = inlineNodes(node, baseUrl, warnings);
    return text.length
      ? [
          {
            type: "heading",
            level: Number(tag.slice(1)),
            children: text,
          },
        ]
      : undefined;
  }
  if (tag === "hr") return [{ type: "thematic-break" }];
  if (tag === "figure")
    return [
      {
        type: "figure",
        blocks: extractBlocks(node.children, baseUrl, warnings),
      },
    ];
  if (
    isMathNode(node) &&
    (isDisplayMathNode(node) ||
      (tag === "math" && attr(node, "display") !== "inline"))
  ) {
    const value = mathValue(node);
    return value ? [{ type: "math", value }] : undefined;
  }
  if (isMathNode(node)) {
    const value = mathValue(node);
    if (!value) return undefined;
    return [{ type: "paragraph", children: [{ type: "inline-math", value }] }];
  }
  if (tag === "pre") return [codeBlock(node)];
  if (tag === "table") return [tableBlock(node, baseUrl, warnings)];
  if (tag === "ul" || tag === "ol")
    return [listBlock(node, baseUrl, warnings, tag === "ol")];
  if (tag === "blockquote") {
    return [
      {
        type: "quote",
        blocks: extractBlocks(node.children, baseUrl, warnings),
      },
    ];
  }
  if (tag === "img") {
    const url = resolveResourceUrl(
      attr(node, "src") ?? attr(node, "data-src"),
      baseUrl,
    );
    if (!url) return undefined;
    return [
      {
        type: "image",
        url,
        alt: attr(node, "alt") ?? "",
        ...(attr(node, "title") != null ? { title: attr(node, "title") } : {}),
        ...imageSizing(node),
      },
    ];
  }
  if (tag === "center") {
    const inner = extractBlocks(node.children, baseUrl, warnings);
    return inner.length
      ? [{ type: "align", align: "center", blocks: inner }]
      : undefined;
  }
  if (tag === "p" || tag === "figcaption" || tag === "address") {
    const children = inlineNodes(node, baseUrl, warnings);
    return children.length
      ? [
          {
            type: "paragraph",
            children,
            ...(tag === "figcaption" ||
            attr(node, "data-ojtrace-caption") === "true"
              ? { caption: true }
              : {}),
          },
        ]
      : undefined;
  }
  if (!BLOCK_TAGS.has(tag)) return undefined;
  // A container that also holds images, centers, or other blocks cannot be
  // one paragraph: flattening it pulls captions apart from their figures.
  // Inline siblings are merged by extractBlocks instead.
  if (
    node.children.some(
      (child) => child.type === "element" && isFlowBoundary(child),
    )
  )
    return undefined;
  const children = inlineNodes(node, baseUrl, warnings);
  return children.length ? [{ type: "paragraph", children }] : undefined;
}

function inlineNodes(
  node: HtmlElementNode,
  baseUrl: string,
  warnings: ProblemWarning[],
): InlineNode[] {
  const result: InlineNode[] = [];
  const appendText = (value: string): void => {
    for (const part of tokenizeMathText(value)) {
      if (part.type === "math") {
        result.push({
          type: "inline-math",
          value: part.value,
          ...(part.display ? { display: true } : {}),
        });
        continue;
      }
      const normalized = part.value.replace(/\s+/g, " ");
      if (!normalized) continue;
      const previous = result[result.length - 1];
      if (previous?.type === "text") previous.value += normalized;
      else result.push({ type: "text", value: normalized });
    }
  };
  const visit = (child: HtmlNode): void => {
    if (child.type === "text") {
      appendText(child.value);
      return;
    }
    if (attr(child, "data-ojtrace-text") === "true") {
      const value = child.children
        .map((node) => (node.type === "text" ? node.value : ""))
        .join("");
      const previous = result.at(-1);
      if (previous?.type === "text") previous.value += value;
      else result.push({ type: "text", value });
      return;
    }
    if (SKIP_TAGS.has(child.tagName) && !isMathSourceScript(child)) return;
    if (isMathVisualDuplicate(child)) return;
    if (isMathSourceScript(child)) {
      const value = mathValue(child);
      if (value)
        result.push({
          type: "inline-math",
          value,
          ...(isDisplayMathNode(child) ? { display: true } : {}),
        });
      return;
    }
    if (child.tagName === "br") {
      result.push({ type: "break" });
      return;
    }
    if (child.tagName === "img") {
      const url = resolveResourceUrl(
        attr(child, "src") ?? attr(child, "data-src"),
        baseUrl,
      );
      if (url)
        result.push({
          type: "image-inline",
          url,
          alt: attr(child, "alt") ?? "",
          ...(attr(child, "title") != null
            ? { title: attr(child, "title") }
            : {}),
          ...imageSizing(child),
        });
      return;
    }
    if (child.tagName === "code" && child.parent?.tagName !== "pre") {
      result.push({ type: "inline-code", value: codeText(child) });
      return;
    }
    if (child.tagName === "var") {
      const value = varMathSource(child);
      if (value) result.push({ type: "inline-math", value });
      return;
    }
    if (isMathNode(child)) {
      const value = mathValue(child);
      if (value)
        result.push({
          type: "inline-math",
          value,
          ...(isDisplayMathNode(child) ? { display: true } : {}),
        });
      return;
    }
    if (child.tagName === "a") {
      const rawUrl = attr(child, "href");
      const url = resolveResourceUrl(rawUrl, baseUrl);
      const children = inlineNodes(child, baseUrl, warnings);
      if (rawUrl && !url)
        warnings.push({
          code: "unsafe-link",
          message: "已忽略无法安全解析的题面链接。",
        });
      if (url && children.length)
        result.push({
          type: "link",
          url,
          children,
          ...(attr(child, "title") != null
            ? { title: attr(child, "title") }
            : {}),
        });
      else result.push(...children);
      return;
    }
    if (child.tagName === "strong" || child.tagName === "b") {
      result.push({
        type: "strong",
        children: inlineNodes(child, baseUrl, warnings),
      });
      return;
    }
    if (child.tagName === "del" || child.tagName === "s") {
      result.push({
        type: "delete",
        children: inlineNodes(child, baseUrl, warnings),
      });
      return;
    }
    if (child.tagName === "em" || child.tagName === "i") {
      result.push({
        type: "emphasis",
        children: inlineNodes(child, baseUrl, warnings),
      });
      return;
    }
    if (child.tagName === "p" && result.length) {
      appendText(" ");
    }
    for (const nested of child.children) visit(nested);
  };
  for (const child of node.children) visit(child);
  const bounded =
    BLOCK_TAGS.has(node.tagName) ||
    node.tagName === "td" ||
    node.tagName === "th";
  const literalEdges =
    bounded &&
    findAll(node, (child) => attr(child, "data-ojtrace-text") === "true")
      .length > 0;
  // Normal HTML block-edge whitespace collapses in the page. In particular,
  // the newline before a nested list is not a trailing space in its sentence.
  // Explicit literal spans keep their exact bytes for Markdown/HTML round trips.
  if (bounded && !literalEdges) {
    const first = result[0];
    const last = result.at(-1);
    if (first?.type === "text") first.value = first.value.trimStart();
    if (last?.type === "text") last.value = last.value.trimEnd();
  }
  return trimInline(result);
}

interface TextPart {
  type: "text" | "math";
  value: string;
  display?: boolean;
}

/** Split text math delimiters without treating an unmatched delimiter as math. */
function tokenizeMathText(value: string): TextPart[] {
  const result: TextPart[] = [];
  let cursor = 0;
  let textStart = 0;
  const appendText = (end: number): void => {
    if (end > textStart)
      result.push({ type: "text", value: value.slice(textStart, end) });
  };
  while (cursor < value.length) {
    const at = value[cursor];
    const next = value[cursor + 1];
    let opener: string | undefined;
    let closer: string | undefined;
    let display = false;
    if (
      at === "\\" &&
      !isEscaped(value, cursor) &&
      (next === "(" || next === "[")
    ) {
      opener = `\\${next}`;
      closer = next === "(" ? "\\)" : "\\]";
      display = next === "[";
    } else {
      const dollars = matchDollarRun(value, cursor);
      if (dollars) {
        opener = dollars.delimiter;
        closer = dollars.delimiter;
        display = dollars.display;
      }
    }
    if (!opener || !closer) {
      cursor += 1;
      continue;
    }
    const contentStart = cursor + opener.length;
    const close = findUnescaped(value, closer, contentStart);
    const content =
      close < 0 ? undefined : value.slice(contentStart, close).trim();
    if (close < 0 || !content) {
      cursor += opener.length;
      continue;
    }
    appendText(cursor);
    result.push({
      type: "math",
      value: content,
      ...(display ? { display: true } : {}),
    });
    cursor = close + closer.length;
    textStart = cursor;
  }
  appendText(value.length);
  return result.length > 0 ? result : [{ type: "text", value }];
}

/**
 * Codeforces writes inline formulas as $$$...$$$ and display formulas as
 * $$$$$$...$$$$$$. $$...$$ stays display math, and $...$ stays inline.
 */
function matchDollarRun(
  value: string,
  cursor: number,
): { delimiter: string; display: boolean } | undefined {
  if (value[cursor] !== "$" || isEscaped(value, cursor)) return undefined;
  let count = 0;
  while (value[cursor + count] === "$") count += 1;
  const lengths = [6, 3, 2, 1].filter((length) => length <= count);
  for (const length of lengths) {
    const delimiter = "$".repeat(length);
    const contentStart = cursor + length;
    const close = findUnescaped(value, delimiter, contentStart);
    if (close < 0) continue;
    if (!value.slice(contentStart, close).trim()) continue;
    return { delimiter, display: length === 2 || length >= 6 };
  }
  return undefined;
}

function findUnescaped(value: string, needle: string, start: number): number {
  let index = start;
  while ((index = value.indexOf(needle, index)) >= 0) {
    if (!isEscaped(value, index)) return index;
    index += needle.length;
  }
  return -1;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  )
    slashes += 1;
  return slashes % 2 === 1;
}

function isMathSourceScript(node: HtmlElementNode): boolean {
  if (node.tagName !== "script") return false;
  const type = attr(node, "type")?.toLowerCase() ?? "";
  return type.startsWith("math/tex") || type === "application/x-tex";
}

function isDisplayMathNode(node: HtmlElementNode): boolean {
  const type = attr(node, "type")?.toLowerCase() ?? "";
  return (
    /(?:mode\s*=\s*display|display)/i.test(type) ||
    hasClass(node, "math-block") ||
    hasClass(node, "math-display") ||
    hasClass(node, "katex-display") ||
    hasClass(node, "MathJax_Display") ||
    hasClass(node, "mathjax_display") ||
    (node.tagName === "math" && attr(node, "display") === "block") ||
    (node.tagName === "mjx-container" && attr(node, "display") === "true")
  );
}

function isMathVisualDuplicate(node: HtmlElementNode): boolean {
  if (hasClass(node, "MathJax_Ignore")) return true;
  if (hasClass(node, "katex-mathml"))
    return Boolean(node.parent && hasClass(node.parent, "katex"));
  const mathJaxVisual =
    node.tagName === "mjx-container" ||
    (node.attrs.class ?? "")
      .split(/\s+/)
      .some((name) => name === "MathJax" || name.startsWith("MathJax_"));
  if (!mathJaxVisual) return false;
  const parent = node.parent;
  if (!parent) return false;
  // MathJax 2 keeps the original TeX script beside preview/rendered nodes.
  // Use that source once rather than concatenating rendered glyphs with it.
  return parent.children.some(
    (sibling) => sibling.type === "element" && isMathSourceScript(sibling),
  );
}

function codeText(node: HtmlElementNode): string {
  const visit = (current: HtmlNode): string => {
    if (current.type === "text") return current.value;
    if (current.tagName === "br") return "\n";
    if (current.tagName === "var" || isMathNode(current))
      return plainCodeMath(
        current.tagName === "var" ? varMathSource(current) : mathValue(current),
      );
    const value = current.children.map(visit).join("");
    return attr(current, "data-ojtrace-code-line") === "true" &&
      !value.endsWith("\n")
      ? `${value}\n`
      : value;
  };
  return visit(node);
}

function varMathSource(node: HtmlElementNode): string {
  if (containsMathSource(node)) return mathValue(node);
  return stripMathDelimiters(rawVarTeX(node));
}

function containsMathSource(node: HtmlElementNode): boolean {
  return (
    Boolean(attr(node, "data-math") || attr(node, "alttext")) ||
    findAll(
      node,
      (item) =>
        item.tagName === "annotation" ||
        item.tagName === "math" ||
        isMathSourceScript(item) ||
        isMathNode(item),
    ).length > 0
  );
}

function rawVarTeX(node: HtmlElementNode): string {
  const visit = (current: HtmlNode): string => {
    if (current.type === "text") return current.value;
    if (current.tagName === "br") return " ";
    const inner = current.children.map(visit).join("");
    if (current.tagName === "sub") return `_{${inner}}`;
    if (current.tagName === "sup") return `^{${inner}}`;
    return inner;
  };
  return node.children.map(visit).join("").replace(/\s+/g, " ").trim();
}

function codeLines(node: HtmlElementNode): InlineNode[][] {
  const lines: InlineNode[][] = [[]];
  const appendText = (value: string): void => {
    const parts = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (!part) return;
      const current = lines.at(-1);
      if (!current) return;
      const previous = current.at(-1);
      if (previous && previous.type === "text") previous.value += part;
      else current.push({ type: "text", value: part });
    });
  };
  const appendMath = (value: string): void => {
    const trimmed = stripMathDelimiters(value).trim();
    if (!trimmed) return;
    lines.at(-1)?.push({ type: "inline-math", value: trimmed });
  };
  const visit = (current: HtmlNode): void => {
    if (current.type === "text") {
      appendText(current.value);
      return;
    }
    if (current.tagName === "br") {
      lines.push([]);
      return;
    }
    if (SKIP_TAGS.has(current.tagName) && !isMathSourceScript(current)) return;
    if (isMathVisualDuplicate(current)) return;
    if (current.tagName === "var" || isMathNode(current)) {
      appendMath(
        current.tagName === "var" ? varMathSource(current) : mathValue(current),
      );
      return;
    }
    const exampleLine = attr(current, "data-ojtrace-code-line") === "true";
    if (exampleLine && (lines.at(-1)?.length ?? 0) > 0) lines.push([]);
    for (const child of current.children) visit(child);
    if (exampleLine) lines.push([]);
  };
  for (const child of node.children) visit(child);
  return lines;
}

function isBlankCodeLine(line: readonly InlineNode[]): boolean {
  return line.every((node) => node.type === "text" && !node.value.trim());
}

function trimOuterCodeLines(lines: readonly InlineNode[][]): InlineNode[][] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlankCodeLine(lines[start] ?? [])) start += 1;
  while (end > start && isBlankCodeLine(lines[end - 1] ?? [])) end -= 1;
  return lines
    .slice(start, end)
    .map((line) => (isBlankCodeLine(line) ? [] : [...line]));
}

function codeLineHasMath(lines: readonly (readonly InlineNode[])[]): boolean {
  return lines.some((line) => line.some((node) => node.type === "inline-math"));
}

function codeBlock(node: HtmlElementNode): CodeBlock {
  const code = findAll(node, (child) => child.tagName === "code")[0];
  const source = code ?? node;
  const exact = attr(node, "data-ojtrace-code") === "exact";
  const value = exact
    ? codeText(source)
    : codeText(source).replace(/^\n|\n$/g, "");
  const lines = exact
    ? codeLines(source)
    : trimOuterCodeLines(codeLines(source));
  const className = code?.type === "element" ? (code.attrs.class ?? "") : "";
  const match = className.match(/(?:language|lang)-([\w+-]+)/i);
  const classLanguage = match?.[1];
  const namedLanguage =
    classLanguage && (exact || classLanguage.toLowerCase() !== "text")
      ? classLanguage
      : undefined;
  return {
    type: "code",
    value,
    ...(attr(node, "data-caption") != null
      ? { caption: attr(node, "data-caption") }
      : {}),
    ...(codeLineHasMath(lines) ? { lines } : {}),
    ...(namedLanguage ? { language: namedLanguage } : {}),
  };
}

function listBlock(
  node: HtmlElementNode,
  baseUrl: string,
  warnings: ProblemWarning[],
  ordered: boolean,
): ListBlock {
  const items = node.children
    .filter(
      (child): child is HtmlElementNode =>
        child.type === "element" && child.tagName === "li",
    )
    .map((item) => {
      const children = extractBlocks(item.children, baseUrl, warnings);
      const checkbox = findAll(
        item,
        (child) =>
          child.tagName === "input" && attr(child, "type") === "checkbox",
      ).find((child) => {
        let parent = child.parent;
        while (parent && parent !== item) {
          if (parent.tagName === "li") return false;
          parent = parent.parent;
        }
        return parent === item;
      });
      const declared = attr(item, "data-ojtrace-checked");
      return {
        ...(declared != null
          ? { checked: declared === "true" }
          : checkbox
            ? { checked: Object.hasOwn(checkbox.attrs, "checked") }
            : {}),
        children,
      };
    });
  const start = Number(attr(node, "start"));
  return {
    type: "list",
    ordered,
    ...(ordered &&
    Number.isInteger(start) &&
    start !== 1 &&
    attr(node, "start") != null
      ? { start }
      : {}),
    items,
  };
}

interface GridCell {
  children: InlineNode[];
  colspan: number;
  rowspan: number;
  removed: boolean;
  align?: TableColumnAlign;
}

/** HTML omits cells covered by row/col spans; Markdown uses a complete grid. */
function expandTableGrid(rows: GridCell[][]): GridCell[][] {
  const grid: GridCell[][] = rows.map(() => []);
  const explicit = rows.some((row) => row.some((cell) => cell.removed));
  let count = 0;
  for (const [r, row] of rows.entries()) {
    let column = 0;
    for (const cell of row) {
      if (cell.removed) {
        // Our controlled HTML already writes explicit covered positions.
        if (!grid[r]?.[column]?.removed) return rows;
        column++;
        continue;
      }
      if (!explicit) while (grid[r]?.[column]) column++;
      for (let y = r; y < Math.min(rows.length, r + cell.rowspan); y++) {
        for (let x = column; x < column + cell.colspan; x++) {
          if (grid[y]?.[x]) return rows; // Invalid overlap: retain all source cells.
          if (++count > TABLE_CELL_LIMIT)
            throw new RangeError("Table cell budget exceeded");
          grid[y]![x] =
            y === r && x === column
              ? cell
              : {
                  children: [],
                  colspan: 1,
                  rowspan: 1,
                  removed: true,
                };
        }
      }
      column += explicit ? 1 : cell.colspan;
    }
  }
  return grid;
}

function tableBlock(
  node: HtmlElementNode,
  baseUrl: string,
  warnings: ProblemWarning[],
): TableBlock {
  const sourceRows: GridCell[][] = [];
  let headerCount = 0;
  let cellCount = 0;
  for (const row of findAll(node, (item) => item.tagName === "tr")) {
    let parent = row.parent;
    while (parent && parent !== node && parent.tagName !== "table")
      parent = parent.parent;
    if (parent !== node) continue;
    const cells = row.children.filter(
      (child): child is HtmlElementNode =>
        child.type === "element" &&
        (child.tagName === "td" || child.tagName === "th"),
    );
    cellCount += cells.length;
    if (cellCount > TABLE_CELL_LIMIT)
      throw new RangeError("Table cell budget exceeded");
    const isHeader =
      sourceRows.length === 0 &&
      (cells.some((cell) => cell.tagName === "th") ||
        row.parent?.tagName === "thead");
    if (isHeader) headerCount = 1;
    sourceRows.push(
      cells.map((cell) => ({
        children: inlineNodes(cell, baseUrl, warnings),
        colspan: spanCount(attr(cell, "colspan")),
        rowspan: spanCount(attr(cell, "rowspan")),
        removed: attr(cell, "data-ojtrace-covered") === "true",
        ...cellAlign(cell),
      })),
    );
  }
  const grid = expandTableGrid(sourceRows);
  const spans = grid.map((row) =>
    row.map((cell) =>
      cell.removed ? null : { colspan: cell.colspan, rowspan: cell.rowspan },
    ),
  );
  const spanned = spans.some((row) =>
    row.some((cell) => cell === null || cell.colspan > 1 || cell.rowspan > 1),
  );
  const headerRow = headerCount === 1 ? grid[0] : undefined;
  const alignments = columnAlignments(sourceRows[0]);
  return {
    type: "table",
    headers: headerRow ? headerRow.map((cell) => cell.children) : [],
    rows: grid
      .slice(headerCount)
      .map((row) => row.map((cell) => cell.children)),
    ...(attr(node, "data-ojtrace-table") === "tuack"
      ? { style: "tuack" as const }
      : {}),
    ...(spanned ? { spans } : {}),
    ...(alignments ? { alignments } : {}),
  };
}

function cellAlign(node: HtmlElementNode): { align?: TableColumnAlign } {
  const style = styleDeclarations(attr(node, "style"))
    .get("text-align")
    ?.toLowerCase();
  const attribute = attr(node, "align")?.toLowerCase();
  const value = style || attribute;
  if (value === "left" || value === "center" || value === "right")
    return { align: value };
  return {};
}

function columnAlignments(
  row: readonly GridCell[] | undefined,
): (TableColumnAlign | null)[] | undefined {
  if (!row) return undefined;
  const alignments: (TableColumnAlign | null)[] = [];
  for (const cell of row) {
    if (cell.removed) continue;
    const align = cell.align ?? null;
    for (let index = 0; index < cell.colspan; index += 1)
      alignments.push(align);
  }
  return alignments.some((align) => align !== null) ? alignments : undefined;
}

function spanCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (parsed > TABLE_SPAN_LIMIT)
    throw new RangeError("Table span budget exceeded");
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

function isMathNode(node: HtmlElementNode): boolean {
  return (
    node.tagName === "math" ||
    node.tagName === "mjx-container" ||
    isMathSourceScript(node) ||
    hasClass(node, "katex") ||
    hasClass(node, "katex-display") ||
    hasClass(node, "mathjax") ||
    hasClass(node, "mathjax_display") ||
    hasClass(node, "MathJax_Preview") ||
    hasClass(node, "mathjaxcontainer") ||
    hasClass(node, "MathJax") ||
    hasClass(node, "MathJax_Display") ||
    hasClass(node, "math") ||
    hasClass(node, "math-block") ||
    hasClass(node, "math-display") ||
    Boolean(node.attrs["data-math"])
  );
}

function mathValue(node: HtmlElementNode): string {
  const annotation = findAll(
    node,
    (item) =>
      item.tagName === "annotation" &&
      (!attr(item, "encoding") ||
        /^(?:application|text)\/(?:x-)?(?:tex|latex)$/i.test(
          attr(item, "encoding") ?? "",
        )),
  )[0];
  const sourceScript = findAll(node, isMathSourceScript)[0];
  const sourceElement = findAll(node, (item) =>
    Boolean(attr(item, "data-math") || attr(item, "alttext")),
  )[0];
  const raw =
    attr(node, "data-math") ??
    attr(node, "alttext") ??
    (sourceElement ? attr(sourceElement, "data-math") : undefined) ??
    (sourceElement ? attr(sourceElement, "alttext") : undefined) ??
    (isMathSourceScript(node) ? trimmedText(node) : undefined) ??
    (sourceScript ? trimmedText(sourceScript) : undefined) ??
    (annotation ? trimmedText(annotation) : undefined);
  if (raw != null) return stripMathDelimiters(raw.trim());
  const isRendered = (item: HtmlElementNode): boolean =>
    item.tagName === "math" ||
    item.tagName === "mjx-container" ||
    hasClass(item, "katex") ||
    hasClass(item, "katex-display") ||
    hasClass(item, "MathJax") ||
    hasClass(item, "MathJax_Preview") ||
    hasClass(item, "MathJax_Display");
  const text = trimmedText(node);
  if (isRendered(node) || findAll(node, isRendered).length)
    throw new SyntaxError(
      "未找到公式的 LaTeX 源码，无法从渲染后的符号恢复公式。请刷新题目页后重试。",
    );
  return stripMathDelimiters(text);
}

function stripMathDelimiters(value: string): string {
  const pairs: readonly [string, string][] = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ];
  for (const [open, close] of pairs) {
    if (value.startsWith(open) && value.endsWith(close))
      return value.slice(open.length, -close.length).trim();
  }
  return value;
}

function trimInline(items: readonly InlineNode[]): InlineNode[] {
  const result = [...items];
  while (result[0]?.type === "text" && !result[0].value.trim()) result.shift();
  let last = result.at(-1);
  while (last?.type === "text" && !last.value.trim()) {
    result.pop();
    last = result.at(-1);
  }
  return result;
}

function parseDimension(value: string | undefined): number | undefined {
  const number = value ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function isInlineFlowElement(node: HtmlElementNode): boolean {
  if (node.tagName === "br") return true;
  // KaTeX is one inline formula. Its MathML/SVG implementation is not a set
  // of document block boundaries (especially before a nested list).
  if (isMathNode(node)) return !isFlowBoundary(node);
  if (isFlowBoundary(node) || containsFlowBoundary(node)) return false;
  return true;
}

function isFlowBoundary(node: HtmlElementNode): boolean {
  if (BLOCK_TAGS.has(node.tagName)) return true;
  if (node.tagName === "center" || node.tagName === "img") return true;
  if (!isMathNode(node)) return false;
  if (isDisplayMathNode(node)) return true;
  return node.tagName === "math" && attr(node, "display") !== "inline";
}

function containsFlowBoundary(node: HtmlElementNode): boolean {
  return node.children.some((child) => {
    if (child.type !== "element") return false;
    return (
      isFlowBoundary(child) ||
      (!isMathNode(child) && containsFlowBoundary(child))
    );
  });
}

function paragraphsFromInline(nodes: readonly InlineNode[]): MarkdownBlock[] {
  const groups: InlineNode[][] = [];
  let current: InlineNode[] = [];
  let breaks = 0;
  const pushCurrent = (): void => {
    const children = stripEdgeBreaks(current);
    if (children.length > 0) groups.push(children);
    current = [];
    breaks = 0;
  };
  for (const node of nodes) {
    if (node.type === "break") {
      breaks += 1;
      if (breaks >= 2) pushCurrent();
      else current.push(node);
      continue;
    }
    breaks = 0;
    current.push(node);
  }
  pushCurrent();
  return groups.map((children) => ({ type: "paragraph", children }));
}

function stripEdgeBreaks(nodes: readonly InlineNode[]): InlineNode[] {
  const result = [...nodes];
  const blank = (node: InlineNode | undefined): boolean =>
    node?.type === "break" || (node?.type === "text" && !node.value.trim());
  while (blank(result[0])) result.shift();
  while (blank(result.at(-1))) result.pop();
  return result;
}

function imageSizing(node: HtmlElementNode): ImageFrame {
  const style = styleDeclarations(attr(node, "style"));
  const zoom = parseZoom(style.get("zoom"));
  const widthStyle = parseCssLength(style.get("width"));
  const heightStyle = parseCssLength(style.get("height"));
  const maxWidth = parseCssLength(style.get("max-width"));
  const maxHeight = parseCssLength(style.get("max-height"));
  const width =
    widthStyle?.unit === "px"
      ? widthStyle.value
      : parseDimension(attr(node, "width"));
  const height =
    heightStyle?.unit === "px"
      ? heightStyle.value
      : parseDimension(attr(node, "height"));
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(widthStyle?.unit === "%" ? { widthRatio: widthStyle.value / 100 } : {}),
    ...(zoom === undefined ? {} : { zoom }),
    ...(maxWidth?.unit === "%" ? { maxWidthRatio: maxWidth.value / 100 } : {}),
    ...(maxWidth?.unit === "px" ? { maxWidthPx: maxWidth.value } : {}),
    ...(maxHeight?.unit === "%"
      ? { maxHeightRatio: maxHeight.value / 100 }
      : {}),
    ...(maxHeight?.unit === "px" ? { maxHeightPx: maxHeight.value } : {}),
  };
}

function styleDeclarations(style: string | undefined): Map<string, string> {
  const declarations = new Map<string, string>();
  if (!style) return declarations;
  for (const part of style.split(";")) {
    const separator = part.indexOf(":");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part
      .slice(separator + 1)
      .replace(/!important$/i, "")
      .trim();
    if (key && value) declarations.set(key, value);
  }
  return declarations;
}

function parseCssLength(
  value: string | undefined,
): { value: number; unit: "px" | "%" } | undefined {
  if (!value || value.toLowerCase() === "auto") return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(px|%)?$/i);
  if (!match?.[1]) return undefined;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return { value: number, unit: match[2]?.toLowerCase() === "%" ? "%" : "px" };
}

function parseZoom(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(%)?$/);
  if (!match?.[1]) return undefined;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return match[2] === "%" ? number / 100 : number;
}

/** Decode only explicit inline HTML; no statement-role inference. */
export function decodeInlineHtml(
  html: string,
  baseUrl: string,
): readonly InlineNode[] {
  const root = parseHtmlDocument(html);
  return inlineNodes(
    { type: "element", tagName: "span", attrs: {}, children: root.children },
    baseUrl,
    [],
  );
}
