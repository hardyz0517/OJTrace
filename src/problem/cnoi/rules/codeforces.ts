import type { MarkdownRoot } from "../../markdown/ast";
import type { BuiltinAliases } from "./common";
export const codeforcesRules: BuiltinAliases = {
  aliases: { samples: ["^example tests?$"], hint: ["^note$"] },
};
import type { MarkdownBlock, InlineNode } from "../../markdown/ast";
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
      if (previous?.type === "text")
        released[released.length - 1] = {
          ...previous,
          value: previous.value + node.value,
        };
      else released.push({ type: "text", value: node.value });
      continue;
    }
    if (node.type === "text" && previous?.type === "text") {
      released[released.length - 1] = {
        ...previous,
        value: previous.value + node.value,
      };
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

export function prepareCodeforcesAst(ast: MarkdownRoot): MarkdownRoot {
  const inlines = (nodes: readonly InlineNode[]): InlineNode[] =>
    releaseQuotedCode(
      nodes.map((node) =>
        "children" in node
          ? { ...node, children: inlines(node.children) }
          : node,
      ),
    );
  const visit = (block: MarkdownBlock): MarkdownBlock => {
    if (block.type === "heading" || block.type === "paragraph")
      return { ...block, children: inlines(block.children) };
    if (block.type === "table")
      return {
        ...block,
        headers: block.headers.map(inlines),
        rows: block.rows.map((row) => row.map(inlines)),
      };
    if (
      block.type === "quote" ||
      block.type === "figure" ||
      block.type === "align"
    )
      return { ...block, blocks: block.blocks.map(visit) };
    if (block.type === "list")
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          children: item.children.map(visit),
        })),
      };
    return block;
  };
  return { ...ast, children: ast.children.map(visit) };
}
