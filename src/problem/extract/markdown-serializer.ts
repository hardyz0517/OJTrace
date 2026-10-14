import type {
  StatementBlock,
  InlineNode,
  CodeBlock,
  TableColumnAlign,
} from "../statement";

export function serializeMarkdown(blocks: readonly StatementBlock[]): string {
  return (
    blocks.map(serializeBlock).filter(Boolean).join("\n\n").trim() +
    (blocks.length ? "\n" : "")
  );
}

function serializeBlock(block: StatementBlock): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(Math.max(1, Math.min(6, block.level)))} ${serializeInline(block.children)}`;
    case "paragraph":
      return serializeInline(block.children);
    case "math":
      return `$$\n${block.value}\n$$`;
    case "code":
      return fencedCode(block);
    case "sample":
      return [
        block.input &&
          `${sampleTitle(block.inputLabel, "输入")}\n${fencedCode(block.input)}`,
        block.output &&
          `${sampleTitle(block.outputLabel, "输出")}\n${fencedCode(block.output)}`,
        block.explanation && `**说明**\n${serializeInline(block.explanation)}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "list":
      return block.items
        .map((item, index) => {
          const body = item.children.map(serializeBlock).join("\n\n");
          return `${block.ordered ? `${index + 1}.` : "-"} ${body.replace(/\n/g, "\n  ")}`;
        })
        .join("\n");
    case "table": {
      const markdown = serializeTable(
        block.headers,
        block.rows,
        block.alignments,
      );
      return block.style === "tuack"
        ? `::cute-table{tuack}\n\n${markdown}`
        : markdown;
    }
    case "align":
      return `:::align{${block.align}}\n\n${block.blocks.map(serializeBlock).filter(Boolean).join("\n\n")}\n\n:::`;
    case "figure": {
      const caption = block.caption
        ? `{caption="${block.caption.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"}`
        : "";
      const inner = block.blocks
        .map(serializeBlock)
        .filter(Boolean)
        .join("\n\n");
      return `:::figure${caption}\n\n${inner}\n\n:::`;
    }
    case "image":
      return `![${escapeText(block.alt)}](${block.url})`;
    case "quote":
      return block.blocks
        .map(serializeBlock)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "thematic-break":
      return "---";
  }
}

function sampleTitle(
  label: StatementBlock | undefined,
  fallback: string,
): string {
  if (label?.type === "heading" || label?.type === "paragraph")
    return serializeBlock(label);
  return `**${fallback}**`;
}

function fencedCode(block: CodeBlock): string {
  const source = block.lines?.length
    ? block.lines.map((line) => serializeInline(line)).join("\n")
    : block.value;
  const language = block.language ?? "text";
  const longestFence = Math.max(
    0,
    ...Array.from(source.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}${language}\n${source.replace(/\n+$/, "")}\n${fence}`;
}

function serializeTable(
  headers: readonly (readonly InlineNode[])[],
  rows: readonly (readonly (readonly InlineNode[])[])[],
  alignments?: readonly (TableColumnAlign | null)[],
): string {
  const columns = Math.max(1, headers.length, ...rows.map((row) => row.length));
  const cell = (nodes: readonly InlineNode[] | undefined): string =>
    serializeInline(nodes ?? [])
      .replace(/\|/g, "\\|")
      .replace(/\n/g, "<br>");
  const row = (values: readonly (readonly InlineNode[])[]): string =>
    `| ${Array.from({ length: columns }, (_, index) => cell(values[index])).join(" | ")} |`;
  return [
    row(headers),
    `| ${Array.from({ length: columns }, (_, index) => alignMarker(alignments?.[index])).join(" | ")} |`,
    ...rows.map(row),
  ].join("\n");
}

function serializeInline(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeText(node.value);
        case "strong":
          return `**${serializeInline(node.children)}**`;
        case "emphasis":
          return `*${serializeInline(node.children)}*`;
        case "link":
          return `[${serializeInline(node.children)}](${node.url})`;
        case "inline-code":
          return inlineCode(node.value);
        case "inline-math":
          return node.display ? `\\[${node.value}\\]` : `$${node.value}$`;
        case "image-inline":
          return `![${escapeText(node.alt)}](${node.url})`;
        case "break":
          return "\n";
      }
    })
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
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
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function alignMarker(align: TableColumnAlign | null | undefined): string {
  if (align === "left") return ":---";
  if (align === "right") return "---:";
  if (align === "center") return ":---:";
  return "---";
}
