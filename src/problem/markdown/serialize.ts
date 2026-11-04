import type {
  MarkdownBlock,
  InlineNode,
  CodeBlock,
  ListBlock,
  TableColumnAlign,
} from "./ast";
import {
  blockHtml,
  codeHtml,
  imageHtml,
  literalHtml,
  inlineHtml,
} from "./html-encode";
import { isTableStyleDirective, markdownSpanMarkers } from "./table";
import { MATH_CODE_LANGUAGE, serializeMathCode } from "./math-code";

export function serializeMarkdown(blocks: readonly MarkdownBlock[]): string {
  return (
    blocks
      .map((block, index) => {
        const value = serializeBlock(block);
        // A comment separates distinct sibling lists in CommonMark without
        // wrapping their editable contents in HTML.
        return block.type === "list" && blocks[index - 1]?.type === "list"
          ? `<!-- -->\n\n${value}`
          : value;
      })
      .filter(Boolean)
      .join("\n\n")
      .trim() + (blocks.length ? "\n" : "")
  );
}

function serializeBlock(block: MarkdownBlock): string {
  switch (block.type) {
    case "heading":
      if (edgeWhitespace(block.children)) return blockHtml(block);
      return `${"#".repeat(Math.max(1, Math.min(6, block.level)))} ${serializeInline(block.children)}`;
    case "paragraph":
      return block.caption ||
        (block.children.length === 1 &&
          (block.children[0]?.type === "image-inline" ||
            (block.children[0]?.type === "inline-math" &&
              block.children[0].display))) ||
        edgeWhitespace(block.children) ||
        blockSyntax(block.children)
        ? blockHtml(block)
        : serializeInline(block.children);
    case "math":
      return `$$\n${block.value}\n$$`;
    case "code":
      return fencedCode(block);
    case "list":
      return serializeList(block);
    case "table": {
      const markers = markdownSpanMarkers(block);
      if (!markers) return blockHtml(block);
      const markdown = serializeTable(
        block.headers,
        block.rows,
        block.alignments,
        markers,
      );
      return block.style === "tuack"
        ? `::cute-table{tuack}\n\n${markdown}`
        : markdown;
    }
    case "align":
    case "figure":
      return blockHtml(block);
    case "image":
      return hasImageFrame(block) ||
        block.title != null ||
        /[()\s"<>]/.test(block.url)
        ? imageHtml(block)
        : `![${escapeText(block.alt)}](${block.url})`;
    case "quote":
      return serializeMarkdown(block.blocks)
        .trimEnd()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "thematic-break":
      return "---";
  }
}

function serializeList(block: ListBlock): string {
  if (
    block.items.some(
      (item) => item.checked != null && item.children[0]?.type !== "paragraph",
    )
  )
    return blockHtml(block);
  const loose = block.items.some((item) =>
    item.children.some((child, index) => index > 0 && child.type !== "list"),
  );
  return block.items
    .map((item, index) => {
      const marker = block.ordered ? `${(block.start ?? 1) + index}.` : "-";
      const body = item.children
        .map((child, at) => {
          const previous = item.children[at - 1];
          const separator =
            child.type === "list" && previous?.type === "list"
              ? "\n\n<!-- -->\n\n"
              : child.type === "list" && previous?.type === "paragraph"
                ? "\n"
                : "\n\n";
          return (at ? separator : "") + serializeBlock(child);
        })
        .join("");
      const prefix =
        item.checked == null ? "" : `[${item.checked ? "x" : " "}] `;
      const [first = "", ...rest] = (prefix + body).split("\n");
      const indent = " ".repeat(marker.length + 1);
      return (
        `${marker}${first ? ` ${first}` : ""}` +
        rest.map((line) => `\n${line ? indent + line : ""}`).join("")
      );
    })
    .join(loose ? "\n\n" : "\n");
}

function fencedCode(block: CodeBlock): string {
  const math = serializeMathCode(block);
  if ((block.lines && math === undefined) || block.caption != null)
    return codeHtml(block);
  // A user-authored language with our reserved name must stay literal code.
  if (!block.lines && block.language === MATH_CODE_LANGUAGE)
    return codeHtml(block);
  const source = math ?? block.value;
  const language =
    math !== undefined ? MATH_CODE_LANGUAGE : (block.language ?? "");
  const longestFence = Math.max(
    0,
    ...Array.from(source.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}${language}\n${source}\n${fence}`;
}

function serializeTable(
  headers: readonly (readonly InlineNode[])[],
  rows: readonly (readonly (readonly InlineNode[])[])[],
  alignments?: readonly (TableColumnAlign | null)[],
  markers?: readonly (readonly string[])[],
): string {
  const columns = Math.max(1, headers.length, ...rows.map((row) => row.length));
  const cell = (nodes: readonly InlineNode[] | undefined): string => {
    const value = serializeInline(nodes ?? [])
      .replace(/\|/g, "\\|")
      .replace(/\n/g, "<br>");
    return value.trim() === "^" ? value.replace("^", "\\^") : value;
  };
  const row = (
    values: readonly (readonly InlineNode[])[],
    rowIndex: number,
  ): string =>
    `| ${Array.from({ length: columns }, (_, index) => markers?.[rowIndex]?.[index] || cell(values[index])).join(" | ")} |`;
  return [
    row(headers, 0),
    `| ${Array.from({ length: columns }, (_, index) => alignMarker(alignments?.[index])).join(" | ")} |`,
    ...rows.map((values, index) => row(values, index + 1)),
  ].join("\n");
}

function serializeInline(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return /[$\\]/.test(node.value)
            ? `<span data-ojtrace-text="true">${literalHtml(node.value)}</span>`
            : escapeText(node.value);
        case "strong":
          if (edgeWhitespace(node.children)) return inlineHtml([node]);
          return `**${serializeInline(node.children)}**`;
        case "delete":
          return `~~${serializeInline(node.children)}~~`;
        case "emphasis":
          if (edgeWhitespace(node.children)) return inlineHtml([node]);
          return `*${serializeInline(node.children)}*`;
        case "link":
          if (/[()\s"<>]/.test(node.url)) return inlineHtml([node]);
          return `[${serializeInline(node.children)}](${node.url}${node.title != null ? ` "${node.title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : ""})`;
        case "inline-code":
          return /^\s|\s$/.test(node.value) || node.value.includes("\n")
            ? inlineHtml([node])
            : inlineCode(node.value);
        case "inline-math":
          return node.value.includes("\n") || node.value.includes("$")
            ? inlineHtml([node])
            : node.display
              ? `\\[${node.value}\\]`
              : `$${node.value}$`;
        case "image-inline":
          return hasImageFrame(node) ||
            node.title != null ||
            /[()\s"<>]/.test(node.url)
            ? imageHtml(node)
            : `![${escapeText(node.alt)}](${node.url})`;
        case "break":
          return "<br>";
      }
    })
    .join("");
}

function hasImageFrame(image: object): boolean {
  return [
    "width",
    "height",
    "zoom",
    "widthRatio",
    "maxWidthRatio",
    "maxWidthPx",
    "maxHeightRatio",
    "maxHeightPx",
  ].some((key) => key in image);
}

function inlineCode(value: string): string {
  const longestFence = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestFence + 1);
  const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${padding}${value}${padding}${fence}`;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replace(/([\\`*_[\]<>])/g, "\\$1");
}

function alignMarker(align: TableColumnAlign | null | undefined): string {
  if (align === "left") return ":---";
  if (align === "right") return "---:";
  if (align === "center") return ":---:";
  return "---";
}

function edgeWhitespace(nodes: readonly InlineNode[]): boolean {
  const first = nodes[0],
    last = nodes.at(-1);
  return (
    (first?.type === "text" && /^\s/.test(first.value)) ||
    (last?.type === "text" && /\s$/.test(last.value))
  );
}

function blockSyntax(nodes: readonly InlineNode[]): boolean {
  const first = nodes[0];
  return (
    first?.type === "text" &&
    (/^(?: {0,3}(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|[>=]))/.test(first.value) ||
      isTableStyleDirective(first.value) ||
      /^:{3,}(?:$|[A-Za-z])/.test(first.value.trim()))
  );
}
