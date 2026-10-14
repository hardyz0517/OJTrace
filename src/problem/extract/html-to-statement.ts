import type { ProblemAsset, ProblemLanguage, ProblemWarning } from "../domain";
import {
  attr,
  findAll,
  hasClass,
  parseHtmlDocument,
  removeNodes,
  trimmedText,
  type HtmlElementNode,
  type HtmlNode,
} from "./html-document";
import { collectImageAssets, resolveResourceUrl } from "./image-assets";
import type {
  ImageFrame,
  InlineNode,
  StatementBlock,
  TableBlock,
  TableColumnAlign,
  CodeBlock,
  ListBlock,
  HeadingBlock,
  ParagraphBlock,
} from "../statement";
import { resolveStatementDirectives } from "./statement-directives";

export interface StatementExtraction {
  blocks: readonly StatementBlock[];
  assets: readonly ProblemAsset[];
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

const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "nav",
  "button",
]);
const UI_CLASSES = new Set([
  "advert",
  "advertisement",
  "ads",
  "sidebar",
  "navigation",
  "submit",
  "discussion",
  "toolbar",
  "footer",
]);

export function htmlToStatement(
  rootHtml: string,
  baseUrl: string,
  language?: ProblemLanguage,
): StatementExtraction {
  const root = parseHtmlDocument(rootHtml);
  removeNodes(root, (node) => {
    if (SKIP_TAGS.has(node.tagName) && !isMathSourceScript(node)) return true;
    if (isCopyControl(node)) return true;
    const className = node.attrs.class ?? "";
    // Match standalone UI classes, never substrings of layout containers
    // such as Luogu's sidebar-container (which also contains the statement).
    return className
      .split(/\s+/)
      .some((name) => UI_CLASSES.has(name.toLowerCase()));
  });
  const warnings: ProblemWarning[] = [];
  const blocks = markFigureCaptions(
    resolveStatementDirectives(
      extractBlocks(root.children, baseUrl, warnings, language),
    ),
  );
  return {
    blocks: coalesceSamples(blocks),
    assets: collectImageAssets(root, baseUrl),
    warnings,
  };
}

function extractBlocks(
  nodes: readonly HtmlNode[],
  baseUrl: string,
  warnings: ProblemWarning[],
  language?: ProblemLanguage,
): StatementBlock[] {
  const blocks: StatementBlock[] = [];
  const pending: HtmlNode[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const inline = inlineNodes(
      {
        type: "element",
        tagName: "span",
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
    const block = extractBlock(node, baseUrl, warnings, language);
    if (block) blocks.push(...block);
    else if (node.children.length > 0)
      blocks.push(...extractBlocks(node.children, baseUrl, warnings, language));
  }
  flush();
  return blocks;
}

function extractBlock(
  node: HtmlElementNode,
  baseUrl: string,
  warnings: ProblemWarning[],
  language?: ProblemLanguage,
): StatementBlock[] | undefined {
  const tag = node.tagName;
  if (hasClass(node, "section-title") || hasClass(node, "section_header")) {
    const children = inlineNodes(node, baseUrl, warnings);
    return children.length
      ? [{ type: "heading", level: 2, children }]
      : undefined;
  }
  if (/^h[1-6]$/.test(tag)) {
    const text = inlineNodes(node, baseUrl, warnings);
    return text.length
      ? [{ type: "heading", level: Number(tag.slice(1)), children: text }]
      : undefined;
  }
  if (tag === "hr") return [{ type: "thematic-break" }];
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
  if (tag === "pre") return [codeBlock(node, language)];
  if (tag === "table") return [tableBlock(node, baseUrl, warnings)];
  if (tag === "ul" || tag === "ol")
    return [listBlock(node, baseUrl, warnings, tag === "ol")];
  if (tag === "blockquote") {
    return [
      {
        type: "quote",
        blocks: extractBlocks(node.children, baseUrl, warnings, language),
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
        ...imageSizing(node),
      },
    ];
  }
  if (tag === "center") {
    const inner = extractBlocks(node.children, baseUrl, warnings, language);
    return inner.length
      ? [{ type: "align", align: "center", blocks: inner }]
      : undefined;
  }
  if (
    tag === "p" ||
    tag === "figure" ||
    tag === "figcaption" ||
    tag === "address"
  ) {
    const children = inlineNodes(node, baseUrl, warnings);
    return children.length ? [{ type: "paragraph", children }] : undefined;
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
          ...imageSizing(child),
        });
      return;
    }
    if (child.tagName === "code" && child.parent?.tagName !== "pre") {
      result.push({ type: "inline-code", value: codeText(child).trim() });
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
    if (hasClass(child, "tex-font-style-tt")) {
      const code = plainInlineText(child);
      if (code) result.push({ type: "inline-code", value: code });
      else result.push(...inlineNodes(child, baseUrl, warnings));
      return;
    }
    if (
      hasClass(child, "tex-font-style-bf") ||
      hasClass(child, "tex-font-style-textbf")
    ) {
      const children = inlineNodes(child, baseUrl, warnings);
      if (children.length) result.push({ type: "strong", children });
      return;
    }
    if (
      hasClass(child, "tex-font-style-it") ||
      hasClass(child, "tex-font-style-textit")
    ) {
      const children = inlineNodes(child, baseUrl, warnings);
      if (children.length) result.push({ type: "emphasis", children });
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
      if (url && children.length) result.push({ type: "link", url, children });
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
  return trimInline(releaseQuotedCode(result));
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

function isCopyControl(node: HtmlElementNode): boolean {
  const className = node.attrs.class ?? "";
  // Site-specific copiers stay in their adapter. These controls appear in more
  // than one statement layout and are not part of the sample text.
  if (/\b(?:btn-copy|copy-button|click-to-copy)\b/i.test(className))
    return true;
  return Boolean(node.attrs["data-clipboard-target"]);
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
    return hasClass(current, "test-example-line") && !value.endsWith("\n")
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

function plainCodeMath(value: string): string {
  return stripMathDelimiters(value)
    .replace(
      /\\(?:mathrm|operatorname|text|textbf|textit|mathit)\s*\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/\\(?:leqq|leq|le)(?![A-Za-z])/g, "≤")
    .replace(/\\(?:geqq|geq|ge)(?![A-Za-z])/g, "≥")
    .replace(/\\(?:neq|ne)(?![A-Za-z])/g, "≠")
    .replace(/\\(?:times|cdot)(?![A-Za-z])/g, "×")
    .replace(/\\(?:ldots|dots|cdots)(?![A-Za-z])/g, "…")
    .replace(/\\vdots(?![A-Za-z])/g, "⋮")
    .replace(/\\ddots(?![A-Za-z])/g, "⋱")
    .replace(/\\lt(?![A-Za-z])/g, "<")
    .replace(/\\gt(?![A-Za-z])/g, ">")
    .replace(/\\(?:quad|qquad|,|;|!)/g, " ")
    .replace(/\\ /g, " ")
    .replace(/_\{([^{}]*)\}/g, "_$1")
    .replace(/\^\{([^{}]*)\}/g, "^$1")
    .replace(/[{}]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
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
    const exampleLine = hasClass(current, "test-example-line");
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

function codeBlock(
  node: HtmlElementNode,
  language?: ProblemLanguage,
): CodeBlock {
  const code = findAll(node, (child) => child.tagName === "code")[0];
  const source = code ?? node;
  const value = codeText(source).replace(/^\n|\n$/g, "");
  const lines = trimOuterCodeLines(codeLines(source));
  const className = code?.type === "element" ? (code.attrs.class ?? "") : "";
  const match = className.match(/(?:language|lang)-([\w+-]+)/i);
  return {
    type: "code",
    value,
    ...(codeLineHasMath(lines) ? { lines } : {}),
    ...(match?.[1]
      ? { language: match[1] }
      : language === "other"
        ? { language: "text" }
        : {}),
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
      const hasStructuralBlock = item.children.some(
        (child) =>
          child.type === "element" &&
          ["ul", "ol", "pre", "table", "blockquote", "hr"].includes(
            child.tagName,
          ),
      );
      // Some OJs wrap phrases and formulas in nested div/p elements inside a
      // single list item. Splitting every such wrapper into separate blocks
      // breaks sentences and range expressions. Preserve true nested content
      // (lists, code, tables, quotes) as blocks; otherwise keep the whole item
      // as one inline paragraph.
      const children = hasStructuralBlock
        ? extractBlocks(item.children, baseUrl, warnings)
        : (() => {
            const inline = inlineNodes(item, baseUrl, warnings);
            return inline.length
              ? [{ type: "paragraph" as const, children: inline }]
              : [];
          })();
      return { children };
    });
  return { type: "list", ordered, items };
}

interface GridCell {
  children: InlineNode[];
  colspan: number;
  rowspan: number;
  removed: boolean;
  align?: TableColumnAlign;
}

function tableBlock(
  node: HtmlElementNode,
  baseUrl: string,
  warnings: ProblemWarning[],
): TableBlock {
  const grid: GridCell[][] = [];
  let headerCount = 0;
  for (const row of findAll(node, (item) => item.tagName === "tr")) {
    const cells = row.children.filter(
      (child): child is HtmlElementNode =>
        child.type === "element" &&
        (child.tagName === "td" || child.tagName === "th"),
    );
    const isHeader =
      headerCount === 0 &&
      (cells.some((cell) => cell.tagName === "th") ||
        row.parent?.tagName === "thead");
    if (isHeader) headerCount = 1;
    grid.push(
      cells.map((cell) => ({
        children: inlineNodes(cell, baseUrl, warnings),
        colspan: spanCount(attr(cell, "colspan")),
        rowspan: spanCount(attr(cell, "rowspan")),
        removed: false,
        ...cellAlign(cell),
      })),
    );
  }
  mergeExtendedTable(grid);
  const spans = grid.map((row) =>
    row.map((cell) =>
      cell.removed ? null : { colspan: cell.colspan, rowspan: cell.rowspan },
    ),
  );
  const spanned = spans.some((row) =>
    row.some((cell) => cell === null || cell.colspan > 1 || cell.rowspan > 1),
  );
  const headerRow = headerCount === 1 ? grid[0] : undefined;
  const alignments = columnAlignments(headerRow ?? grid[0]);
  return {
    type: "table",
    headers: headerRow ? headerRow.map((cell) => cell.children) : [],
    rows: grid
      .slice(headerCount)
      .map((row) => row.map((cell) => cell.children)),
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
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

function isSpanMarker(
  children: readonly InlineNode[],
  marker: "^" | "<",
): boolean {
  let text = "";
  for (const node of children) {
    if (node.type !== "text") return false;
    text += node.value;
  }
  return text.trim() === marker;
}

/** `^` merges upward and `<` merges left, matching Luogu and tuack tables. */
function mergeExtendedTable(grid: GridCell[][]): void {
  for (let rowIndex = grid.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = grid[rowIndex];
    if (!row) continue;
    for (let column = row.length - 1; column >= 1; column -= 1) {
      const cell = row[column];
      const previous = row[column - 1];
      if (!cell || cell.removed || !previous || previous.removed) continue;
      if (!isSpanMarker(cell.children, "<")) continue;
      cell.removed = true;
      previous.colspan += cell.colspan;
    }
  }
  for (let rowIndex = grid.length - 1; rowIndex >= 1; rowIndex -= 1) {
    const row = grid[rowIndex];
    const previousRow = grid[rowIndex - 1];
    if (!row || !previousRow) continue;
    for (let column = 0; column < row.length; column += 1) {
      const cell = row[column];
      const previous = previousRow[column];
      if (!cell || cell.removed || !previous || previous.removed) continue;
      if (!isSpanMarker(cell.children, "^")) continue;
      cell.removed = true;
      previous.rowspan += cell.rowspan;
    }
  }
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
  const annotation = findAll(node, (item) => item.tagName === "annotation")[0];
  const sourceScript = findAll(node, isMathSourceScript)[0];
  const sourceElement = findAll(node, (item) =>
    Boolean(attr(item, "data-math") || attr(item, "alttext")),
  )[0];
  const raw = (
    attr(node, "data-math") ??
    attr(node, "alttext") ??
    (sourceElement ? attr(sourceElement, "data-math") : undefined) ??
    (sourceElement ? attr(sourceElement, "alttext") : undefined) ??
    (isMathSourceScript(node) ? trimmedText(node) : undefined) ??
    (sourceScript ? trimmedText(sourceScript) : undefined) ??
    (annotation ? trimmedText(annotation) : undefined) ??
    trimmedText(node)
  ).trim();
  return stripMathDelimiters(raw);
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

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["\u201c", "\u201d"],
  ["\u00ab", "\u00bb"],
  ["\u300c", "\u300d"],
  ["\u300e", "\u300f"],
  ["\u201e", "\u201c"],
  ["\uff02", "\uff02"],
];

/**
 * Codeforces sets prose quotations in typewriter spans. Those are words in
 * quotes, not code chips; a real identifier without quotes stays inline code.
 */
function releaseQuotedCode(nodes: readonly InlineNode[]): InlineNode[] {
  const released: InlineNode[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    const previous = released[released.length - 1];
    const next = nodes[index + 1];
    if (
      node.type === "inline-code" &&
      shouldReleaseQuotedCode(node.value, previous, next)
    ) {
      if (previous?.type === "text") previous.value += node.value;
      else released.push({ type: "text", value: node.value });
      continue;
    }
    if (node.type === "text" && previous?.type === "text") {
      previous.value += node.value;
      continue;
    }
    released.push(node);
  }
  return released;
}

function shouldReleaseQuotedCode(
  value: string,
  previous: InlineNode | undefined,
  next: InlineNode | undefined,
): boolean {
  if (!value.trim()) return false;
  if (isQuotedLiteral(value)) return true;
  return (
    previous?.type === "text" &&
    next?.type === "text" &&
    isWrappedByQuotePair(previous.value, next.value)
  );
}

function isQuotedLiteral(value: string): boolean {
  const text = value.trim();
  return QUOTE_PAIRS.some(
    ([open, close]) =>
      text.length > open.length + close.length &&
      text.startsWith(open) &&
      text.endsWith(close),
  );
}

function isWrappedByQuotePair(before: string, after: string): boolean {
  const left = before.trimEnd();
  const right = after.trimStart();
  if (!left || !right) return false;
  return QUOTE_PAIRS.some(
    ([open, close]) => left.endsWith(open) && right.startsWith(close),
  );
}

function markFigureCaptions(
  blocks: readonly StatementBlock[],
): StatementBlock[] {
  return captionPass(blocks, false);
}

/**
 * Text under an image, including a following centered note, is a caption.
 * A normal paragraph after that note stays body size.
 */
function captionPass(
  blocks: readonly StatementBlock[],
  inFigure: boolean,
): StatementBlock[] {
  let afterImage = false;
  const marked: StatementBlock[] = [];
  for (const block of blocks) {
    if (block.type === "image") {
      afterImage = true;
      marked.push(block);
      continue;
    }
    if (block.type === "figure") {
      const current = {
        ...block,
        blocks: captionPass(block.blocks, true),
      };
      afterImage = endsWithImage(current);
      marked.push(current);
      continue;
    }
    if (block.type === "align" || block.type === "quote") {
      const current = {
        ...block,
        blocks: captionPass(block.blocks, block.type === "align"),
      };
      if (afterImage && isTextOnlyAlign(current)) {
        marked.push({
          ...current,
          blocks: current.blocks.map((inner) =>
            inner.type === "paragraph" ? { ...inner, caption: true } : inner,
          ),
        });
        afterImage = false;
        continue;
      }
      afterImage = endsWithImage(current);
      marked.push(current);
      continue;
    }
    if (inFigure && afterImage && block.type === "paragraph") {
      marked.push({ ...block, caption: true });
      continue;
    }
    afterImage = false;
    marked.push(block);
  }
  return marked;
}

function isTextOnlyAlign(
  block: StatementBlock,
): block is Extract<StatementBlock, { type: "align" }> {
  return (
    block.type === "align" &&
    block.blocks.length > 0 &&
    block.blocks.every((inner) => inner.type === "paragraph")
  );
}

function endsWithImage(block: StatementBlock | undefined): boolean {
  if (!block) return false;
  if (block.type === "image") return true;
  if (
    block.type === "align" ||
    block.type === "quote" ||
    block.type === "figure"
  )
    return endsWithImage(block.blocks[block.blocks.length - 1]);
  return false;
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
    return isFlowBoundary(child) || containsFlowBoundary(child);
  });
}

function paragraphsFromInline(nodes: readonly InlineNode[]): StatementBlock[] {
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

function plainInlineText(node: HtmlElementNode): string | undefined {
  const parts: string[] = [];
  const visit = (current: HtmlNode): boolean => {
    if (current.type === "text") {
      parts.push(current.value);
      return true;
    }
    if (
      current.tagName === "br" ||
      current.tagName === "img" ||
      isMathNode(current)
    )
      return false;
    return current.children.every(visit);
  };
  if (!node.children.every(visit)) return undefined;
  const value = parts.join("").replace(/\s+/g, " ").trim();
  return value || undefined;
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

function coalesceSamples(blocks: readonly StatementBlock[]): StatementBlock[] {
  const result: StatementBlock[] = [];
  let index = 0;
  while (index < blocks.length) {
    const current = blocks[index];
    if (!current) break;
    const currentLabel = sampleLabel(current);
    if (currentLabel === "input" || currentLabel === "output") {
      const inputCandidate = blocks[index + 1];
      const firstCode: CodeBlock | undefined =
        inputCandidate?.type === "code" ? inputCandidate : undefined;
      const input = currentLabel === "input" ? firstCode : undefined;
      const output = currentLabel === "output" ? firstCode : undefined;
      let consumed = firstCode ? 2 : 1;
      const inputLabel =
        currentLabel === "input" ? sampleTitleBlock(current) : undefined;
      let outputLabel =
        currentLabel === "output" ? sampleTitleBlock(current) : undefined;

      if (currentLabel === "input" && input) {
        const outputHeading = blocks[index + consumed];
        const outputCandidate = blocks[index + consumed + 1];
        if (
          sampleLabel(outputHeading) === "output" &&
          outputCandidate?.type === "code"
        ) {
          consumed += 2;
          outputLabel = sampleTitleBlock(outputHeading);
          const noted = sampleWithNote(blocks, index + consumed, {
            type: "sample",
            input,
            output: outputCandidate,
            ...(inputLabel ? { inputLabel } : {}),
            ...(outputLabel ? { outputLabel } : {}),
          });
          result.push(noted.block);
          index += consumed + noted.consumed;
          continue;
        }
      }

      const sample: StatementBlock = {
        type: "sample",
        ...(input ? { input } : {}),
        ...(output ? { output } : {}),
        ...(inputLabel ? { inputLabel } : {}),
        ...(outputLabel ? { outputLabel } : {}),
      };
      if (input || output) {
        const noted = sampleWithNote(blocks, index + consumed, sample);
        result.push(noted.block);
        index += consumed + noted.consumed;
        continue;
      }
    }
    result.push(current);
    index += 1;
  }
  return result;
}

function sampleWithNote(
  blocks: readonly StatementBlock[],
  at: number,
  sample: StatementBlock,
): { block: StatementBlock; consumed: number } {
  const note = explanationAfter(blocks, at);
  return {
    block:
      note.nodes && sample.type === "sample"
        ? { ...sample, explanation: note.nodes }
        : sample,
    consumed: note.consumed,
  };
}

function explanationAfter(
  blocks: readonly StatementBlock[],
  index: number,
): { nodes?: InlineNode[]; consumed: number } {
  if (!isSampleNote(blocks[index])) return { consumed: 0 };
  const nodes: InlineNode[] = [];
  let cursor = index + 1;
  while (cursor < blocks.length && blocks[cursor]?.type === "paragraph") {
    const paragraph = blocks[cursor];
    if (paragraph?.type !== "paragraph") break;
    if (nodes.length > 0) nodes.push({ type: "break" });
    nodes.push(...paragraph.children);
    cursor += 1;
  }
  if (nodes.length === 0) return { consumed: 0 };
  return { nodes, consumed: cursor - index };
}

function isSampleNote(block: StatementBlock | undefined): boolean {
  if (block?.type !== "heading" && block?.type !== "paragraph") return false;
  const label = inlineText(block.children)
    .replace(/[\s:#：.、_-]+/g, " ")
    .trim();
  return /^(?:explanation|解释|说明)$/i.test(label);
}

function sampleTitleBlock(
  block: StatementBlock | undefined,
): HeadingBlock | ParagraphBlock | undefined {
  if (block?.type !== "heading" && block?.type !== "paragraph")
    return undefined;
  return numberedSampleHeading(block) ?? block;
}

function numberedSampleHeading(
  block: HeadingBlock | ParagraphBlock,
): HeadingBlock | undefined {
  const match = /^(输入|输出)\s*[#＃]\s*(\d+)$/.exec(
    inlineText(block.children).replace(/\s+/g, " ").trim(),
  );
  if (!match) return undefined;
  return {
    type: "heading",
    level: 3,
    children: [{ type: "text", value: `${match[1]} #${match[2]}` }],
  };
}

function sampleLabel(
  block: StatementBlock | undefined,
): "input" | "output" | undefined {
  if (block?.type !== "heading" && block?.type !== "paragraph")
    return undefined;
  const label = inlineText(block.children)
    .replace(/\d+/g, " ")
    .replace(/[\s:#：.、_-]+/g, " ")
    .trim();
  if (/^(?:(?:sample|example|样例|示例)\s*)?(?:input|输入|入力)$/i.test(label))
    return "input";
  if (/^(?:(?:sample|example|样例|示例)\s*)?(?:output|输出|出力)$/i.test(label))
    return "output";
  return undefined;
}

function inlineText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "inline-code":
        case "inline-math":
          return node.value;
        case "strong":
        case "emphasis":
        case "link":
          return inlineText(node.children);
        case "image-inline":
          return node.alt;
        case "break":
          return " ";
      }
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
