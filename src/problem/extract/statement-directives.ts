import type { StatementBlock, TableBlock } from "../statement";

const CALLOUTS = new Set([
  "info",
  "success",
  "warning",
  "error",
  "tip",
  "caution",
  "note",
]);

interface OpenDirective {
  kind: "open";
  name: string;
  colons: number;
  label?: string;
  argument?: string;
}

interface LeafDirective {
  kind: "leaf";
  name: string;
  label?: string;
  argument?: string;
}

interface CloseDirective {
  kind: "close";
  colons: number;
}

type Directive = OpenDirective | LeafDirective | CloseDirective;

function directiveSource(block: StatementBlock): string | undefined {
  if (block.type !== "paragraph") return undefined;
  const parts: string[] = [];
  for (const child of block.children) {
    if (child.type === "text") parts.push(child.value);
    else if (child.type === "inline-math") {
      parts.push(child.display ? `$$${child.value}$$` : `$${child.value}$`);
    } else return undefined;
  }
  const text = parts.join("").trim();
  return text || undefined;
}

function parseDirective(source: string): Directive | undefined {
  const close = /^(:{3,})$/.exec(source);
  if (close?.[1]) return { kind: "close", colons: close[1].length };
  const match =
    /^(:{2,})([A-Za-z][\w-]*)(?:\[([^[\]]*)\])?(?:\{([^{}]*)\})?$/.exec(source);
  if (!match?.[1] || !match[2]) return undefined;
  const colons = match[1].length;
  const label = match[3]?.trim();
  const argument = match[4]?.trim();
  const fields = {
    name: match[2],
    ...(label ? { label } : {}),
    ...(argument ? { argument } : {}),
  };
  return colons === 2
    ? { kind: "leaf", ...fields }
    : { kind: "open", colons, ...fields };
}

function parseBlockDirective(block: StatementBlock): Directive | undefined {
  const source = directiveSource(block);
  return source ? parseDirective(source) : undefined;
}

function findClose(
  blocks: readonly StatementBlock[],
  start: number,
  colons: number,
): number | undefined {
  for (let index = start; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    const directive = parseBlockDirective(block);
    if (directive?.kind === "close" && directive.colons === colons)
      return index;
  }
  return undefined;
}

function applyPendingTable(
  blocks: readonly StatementBlock[],
  style: TableBlock["style"],
): StatementBlock[] {
  if (!style) return [...blocks];
  let used = false;
  const visit = (block: StatementBlock): StatementBlock => {
    if (used) return block;
    if (block.type === "table") {
      used = true;
      return { ...block, style };
    }
    if (
      block.type === "align" ||
      block.type === "quote" ||
      block.type === "figure"
    ) {
      return { ...block, blocks: block.blocks.map(visit) };
    }
    if (block.type === "list") {
      return {
        ...block,
        items: block.items.map((item) => ({
          children: item.children.map(visit),
        })),
      };
    }
    return block;
  };
  return blocks.map(visit);
}

function renderContainer(
  directive: OpenDirective,
  blocks: readonly StatementBlock[],
): StatementBlock[] {
  if (
    directive.name === "align" &&
    (directive.argument === "center" || directive.argument === "right")
  ) {
    return [{ type: "align", align: directive.argument, blocks }];
  }
  if (directive.name === "figure") {
    const caption = figureCaption(directive.argument, directive.label);
    return [
      {
        type: "figure",
        ...(caption ? { caption } : {}),
        blocks,
      },
    ];
  }
  if (directive.name === "epigraph") {
    const quote = [...blocks];
    if (directive.label) {
      quote.push({
        type: "paragraph",
        children: [{ type: "text", value: directive.label }],
      });
    }
    return [{ type: "quote", blocks: quote }];
  }
  if (CALLOUTS.has(directive.name)) {
    const quote: StatementBlock[] = [];
    if (directive.label) {
      quote.push({
        type: "paragraph",
        children: [
          {
            type: "strong",
            children: [{ type: "text", value: directive.label }],
          },
        ],
      });
    }
    quote.push(...blocks);
    return [{ type: "quote", blocks: quote }];
  }
  const unwrapped: StatementBlock[] = [];
  if (directive.label) {
    unwrapped.push({
      type: "paragraph",
      children: [{ type: "text", value: directive.label }],
    });
  }
  unwrapped.push(...blocks);
  return unwrapped;
}

/**
 * Luogu/tuack directives are not CommonMark. A leaf such as
 * `::cute-table{tuack}` styles the following table; container fences such as
 * `:::align{center}` and `:::warning[title]` wrap the blocks until the
 * matching closer. Unknown marker lines are dropped instead of printed.
 */
export function resolveStatementDirectives(
  blocks: readonly StatementBlock[],
): StatementBlock[] {
  const result: StatementBlock[] = [];
  let pendingTableStyle: TableBlock["style"];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    const directive = parseBlockDirective(block);
    if (directive?.kind === "open") {
      const closeAt = findClose(blocks, index + 1, directive.colons);
      if (closeAt === undefined) {
        result.push(block);
        continue;
      }
      const inner = applyPendingTable(
        resolveStatementDirectives(blocks.slice(index + 1, closeAt)),
        pendingTableStyle,
      );
      pendingTableStyle = undefined;
      result.push(...renderContainer(directive, inner));
      index = closeAt;
      continue;
    }
    if (directive?.kind === "close") continue;
    if (directive?.kind === "leaf") {
      if (directive.name === "cute-table") {
        pendingTableStyle = "tuack";
        continue;
      }
      if (directive.label) {
        result.push({
          type: "paragraph",
          children: [{ type: "text", value: directive.label }],
        });
      }
      continue;
    }
    if (block.type === "table" && pendingTableStyle) {
      result.push({ ...block, style: pendingTableStyle });
      pendingTableStyle = undefined;
      continue;
    }
    if (pendingTableStyle) pendingTableStyle = undefined;
    result.push(block);
  }
  return result;
}

function figureCaption(
  argument: string | undefined,
  label: string | undefined,
): string | undefined {
  if (argument) {
    const match =
      /(?:^|,)\s*caption\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,}]+))/.exec(argument);
    const value = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
    if (value) return value;
  }
  const trimmed = label?.trim();
  return trimmed || undefined;
}
