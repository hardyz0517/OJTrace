import type { CodeBlock, InlineNode } from "./ast";
import { STATEMENT_NODE_LIMIT } from "../budget";

/** Explicit fence syntax for preformatted text containing inline LaTeX. */
export const MATH_CODE_LANGUAGE = "text+math";

/** Plain fallback for clients that cannot render formulas inside code. */
export function plainCodeMath(value: string): string {
  return value
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

function plainLines(lines: readonly (readonly InlineNode[])[]): string {
  return lines
    .map((line) =>
      line
        .map((node) =>
          node.type === "inline-math"
            ? plainCodeMath(node.value)
            : node.type === "text"
              ? node.value
              : "",
        )
        .join(""),
    )
    .join("\n");
}

/** Only math delimiters and literal \$ / \\ escapes are active in this fence. */
export function parseMathCode(source: string): CodeBlock {
  const rawLines = source.split("\n", STATEMENT_NODE_LIMIT + 1);
  if (rawLines.length > STATEMENT_NODE_LIMIT)
    throw new RangeError("Markdown math-code line budget exceeded");
  const lines = rawLines.map((line) => {
    const nodes: InlineNode[] = [];
    const append = (value: string) => {
      const previous = nodes.at(-1);
      if (previous?.type === "text") previous.value += value;
      else nodes.push({ type: "text", value });
    };
    for (let at = 0; at < line.length;) {
      if (line[at] === "\\" && /[$\\]/.test(line[at + 1] ?? "")) {
        append(line[at + 1]!);
        at += 2;
        continue;
      }
      if (line[at] === "$") {
        let end = at + 1;
        for (; end < line.length; end++) {
          if (line[end] === "\\") {
            end++;
            continue;
          }
          if (line[end] === "$") break;
        }
        const value = line.slice(at + 1, end);
        if (end < line.length && value.trim()) {
          nodes.push({ type: "inline-math", value });
          at = end + 1;
          continue;
        }
      }
      append(line[at]!);
      at++;
    }
    return nodes;
  });
  return { type: "code", value: plainLines(lines), lines };
}

/** Return undefined when richer inline syntax requires controlled HTML. */
export function serializeMathCode(block: CodeBlock): string | undefined {
  if (!block.lines || block.caption != null || block.language != null)
    return undefined;
  const lines: string[] = [];
  for (const line of block.lines) {
    let value = "";
    for (const node of line) {
      if (node.type === "text" && !/[\r\n]/.test(node.value))
        value += node.value.replaceAll("\\", "\\\\").replaceAll("$", "\\$");
      else if (
        node.type === "inline-math" &&
        !node.display &&
        node.value.trim() &&
        !/[$\r\n]/.test(node.value) &&
        !node.value.endsWith("\\")
      )
        value += `$${node.value}$`;
      else return undefined;
    }
    lines.push(value);
  }
  return plainLines(block.lines) === block.value ? lines.join("\n") : undefined;
}
