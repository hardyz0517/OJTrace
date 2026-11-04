import type { MarkdownBlock } from "./ast";
import { STATEMENT_DEPTH_LIMIT } from "../budget";

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

interface CloseDirective {
  kind: "close";
  colons: number;
}

type Directive = OpenDirective | CloseDirective;

function directiveSource(block: MarkdownBlock): string | undefined {
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
    /^(:{3,})([A-Za-z][\w-]*)(?:\[([^[\]]*)\])?(?:\{([^{}]*)\})?$/.exec(source);
  if (!match?.[1] || !match[2]) return undefined;
  const colons = match[1].length;
  const label = match[3]?.trim();
  const argument = match[4]?.trim();
  const fields = {
    name: match[2],
    ...(label ? { label } : {}),
    ...(argument ? { argument } : {}),
  };
  return { kind: "open", colons, ...fields };
}

function parseBlockDirective(
  block: MarkdownBlock,
  candidates: ReadonlySet<MarkdownBlock>,
): Directive | undefined {
  if (!candidates.has(block)) return undefined;
  const source = directiveSource(block);
  return source ? parseDirective(source) : undefined;
}

function findClose(
  blocks: readonly MarkdownBlock[],
  start: number,
  colons: number,
  candidates: ReadonlySet<MarkdownBlock>,
): number | undefined {
  let depth = 1;
  for (let index = start; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    const directive = parseBlockDirective(block, candidates);
    if (directive?.kind === "open" && directive.colons === colons) depth++;
    if (
      directive?.kind === "close" &&
      directive.colons === colons &&
      --depth === 0
    )
      return index;
  }
  return undefined;
}

function renderContainer(
  directive: OpenDirective,
  blocks: readonly MarkdownBlock[],
): MarkdownBlock[] {
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
    const quote: MarkdownBlock[] = [];
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
  const unwrapped: MarkdownBlock[] = [];
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
 * Layout fences are syntax extensions. Only literal Markdown directive tokens
 * are considered, never escaped text or decoded HTML. Container fences such as
 * `:::align{center}` and `:::warning[title]` wrap the blocks until the
 * matching closer. Unknown marker lines remain literal text.
 */
function resolveStatementDirectives(
  blocks: readonly MarkdownBlock[],
  candidates: ReadonlySet<MarkdownBlock>,
  depth: number,
): MarkdownBlock[] {
  if (depth > STATEMENT_DEPTH_LIMIT)
    throw new RangeError("Markdown directive depth exceeded");
  const result: MarkdownBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    const directive = parseBlockDirective(block, candidates);
    if (
      directive?.kind === "open" &&
      (["align", "figure", "epigraph"].includes(directive.name) ||
        CALLOUTS.has(directive.name))
    ) {
      const closeAt = findClose(
        blocks,
        index + 1,
        directive.colons,
        candidates,
      );
      if (closeAt === undefined) {
        result.push(block);
        continue;
      }
      const inner = resolveStatementDirectives(
        blocks.slice(index + 1, closeAt),
        candidates,
        depth + 1,
      );
      result.push(...renderContainer(directive, inner));
      index = closeAt;
      continue;
    }
    if (directive?.kind === "close") {
      result.push(block);
      continue;
    }
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

export function parseMarkdownDirectives(
  blocks: readonly MarkdownBlock[],
  candidates: ReadonlySet<MarkdownBlock>,
  depth = 0,
): readonly MarkdownBlock[] {
  if (depth > STATEMENT_DEPTH_LIMIT)
    throw new RangeError("Markdown directive depth exceeded");
  const visit = (block: MarkdownBlock): MarkdownBlock => {
    if (
      block.type === "quote" ||
      block.type === "align" ||
      block.type === "figure"
    )
      return {
        ...block,
        blocks: parseMarkdownDirectives(block.blocks, candidates, depth + 1),
      };
    if (block.type === "list")
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          children: parseMarkdownDirectives(
            item.children,
            candidates,
            depth + 1,
          ),
        })),
      };
    return block;
  };
  return resolveStatementDirectives(blocks.map(visit), candidates, depth);
}
