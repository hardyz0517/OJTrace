import { Marked, type Token, type Tokens } from "marked";
import { decodeHtml } from "../../adapters/shared/html";
import {
  PROBLEM_MARKDOWN_LIMIT,
  STATEMENT_DEPTH_LIMIT,
  STATEMENT_NODE_LIMIT,
} from "../budget";
import type { ProblemAsset, ProblemWarning } from "../domain";
import { resolveResourceUrl } from "../extract/resource-url";
import type { InlineNode, MarkdownBlock, MarkdownRoot } from "./ast";
import { decodeInlineHtml, htmlToAst } from "./html";
import { isTableStyleDirective, mergeMarkdownTable } from "./table";
import { parseMarkdownDirectives } from "./directives";
import { MATH_CODE_LANGUAGE, parseMathCode } from "./math-code";

function mathToken(source: string, block: boolean): Tokens.Generic | undefined {
  const prefix = block ? (source.match(/^ {0,3}/)?.[0] ?? "") : "";
  const value = source.slice(prefix.length);
  const open = ["$$$$$$", "$$$", "$$", "\\[", "\\(", "$"].find((marker) =>
    value.startsWith(marker),
  );
  if (!open || (block && !["$$", "$$$$$$", "\\["].includes(open)))
    return undefined;
  const close = open === "\\[" ? "\\]" : open === "\\(" ? "\\)" : open;
  let end = open.length;
  while ((end = value.indexOf(close, end)) >= 0) {
    let slashes = 0;
    for (let cursor = end - 1; cursor >= 0 && value[cursor] === "\\"; cursor--)
      slashes++;
    if (slashes % 2 === 0) break;
    end += close.length;
  }
  if (end < 0) return undefined;
  const text = value.slice(open.length, end).trim();
  if (!text || ((open === "$" || open === "$$$") && text.includes("\n")))
    return undefined;
  return {
    type: block ? "math-block" : "math-inline",
    raw: prefix + value.slice(0, end + close.length),
    text,
    display: ["$$", "$$$$$$", "\\["].includes(open),
  };
}

const parser = new Marked({
  async: false,
  gfm: true,
  extensions: [
    {
      name: "math-inline",
      level: "inline",
      start: (source) => source.search(/\$|\\[([]/),
      tokenizer: (source) => mathToken(source, false),
    },
    {
      name: "math-block",
      level: "block",
      start: (source) => source.search(/^ {0,3}(?:\$\$|\\\[)/m),
      tokenizer: (source) => mathToken(source, true),
    },
  ],
});

export interface MarkdownParseResult {
  readonly ast: MarkdownRoot;
  readonly assets: readonly ProblemAsset[];
  readonly warnings: readonly ProblemWarning[];
}

/** Pure syntax parsing. OJ identity, section roles and CNOI rules are deliberately absent. */
export function parseMarkdown(
  markdown: string,
  options: { baseUrl?: string } = {},
): MarkdownParseResult {
  if (
    markdown.length > PROBLEM_MARKDOWN_LIMIT ||
    new TextEncoder().encode(markdown).byteLength > PROBLEM_MARKDOWN_LIMIT
  )
    throw new RangeError("题面 Markdown 过大，无法解析。");
  const baseUrl = options.baseUrl ?? "https://ojtrace.invalid/";
  const warnings: ProblemWarning[] = [];
  const directiveCandidates = new Set<MarkdownBlock>();
  let count = 0;
  const budget = (depth: number) => {
    if (++count > STATEMENT_NODE_LIMIT || depth > STATEMENT_DEPTH_LIMIT)
      throw new RangeError("Markdown node/depth budget exceeded");
  };
  const inlines = (tokens: readonly Token[], depth: number): InlineNode[] => {
    const result: InlineNode[] = [];
    const text = (value: string) => {
      const last = result.at(-1);
      if (last?.type === "text") last.value += value;
      else if (value) result.push({ type: "text", value });
    };
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!;
      budget(depth);
      switch (token.type) {
        case "checkbox":
          break;
        case "text":
          if (token.tokens) result.push(...inlines(token.tokens, depth + 1));
          else text(decodeHtml(token.text));
          break;
        case "escape":
          text(decodeHtml(token.text));
          break;
        case "strong":
        case "em":
        case "del":
          result.push({
            type:
              token.type === "em"
                ? "emphasis"
                : token.type === "del"
                  ? "delete"
                  : "strong",
            children: inlines(token.tokens ?? [], depth + 1),
          });
          break;
        case "codespan":
          result.push({ type: "inline-code", value: token.text });
          break;
        case "math-inline":
          result.push({
            type: "inline-math",
            value: token.text,
            ...(token.display ? { display: true } : {}),
          });
          break;
        case "br":
          result.push({ type: "break" });
          break;
        case "link": {
          const url = resolveResourceUrl(decodeHtml(token.href), baseUrl);
          const children = inlines(token.tokens ?? [], depth + 1);
          if (url)
            result.push({
              type: "link",
              url,
              children,
              ...(token.title != null
                ? { title: decodeHtml(token.title) }
                : {}),
            });
          else {
            result.push(...children);
            warnings.push({
              code: "unsafe-link",
              message: "已忽略无法安全解析的题面链接。",
            });
          }
          break;
        }
        case "image": {
          const url = resolveResourceUrl(decodeHtml(token.href), baseUrl);
          if (url)
            result.push({
              type: "image-inline",
              url,
              alt: decodeHtml(token.text),
              ...(token.title != null
                ? { title: decodeHtml(token.title) }
                : {}),
            });
          else text(decodeHtml(token.text));
          break;
        }
        case "html": {
          const opening = /^<([a-z][\w-]*)\b[^>]*>/i.exec(token.raw);
          let fragment = token.raw;
          if (
            opening &&
            !/^(?:br|img|hr|input|wbr)$/i.test(opening[1]!) &&
            !opening[0].endsWith("/>") &&
            !fragment.includes(`</${opening[1]}`)
          ) {
            let nesting = 1;
            let cursor = index + 1;
            for (; cursor < tokens.length; cursor++) {
              const raw = tokens[cursor]!.raw;
              if (tokens[cursor]!.type === "html") {
                if (new RegExp(`^<${opening[1]}(?:\\s|>)`, "i").test(raw))
                  nesting++;
                if (new RegExp(`^</${opening[1]}\\s*>`, "i").test(raw))
                  nesting--;
              }
              fragment += raw;
              if (!nesting) {
                index = cursor;
                break;
              }
            }
            if (nesting) {
              text(token.raw);
              break;
            }
          }
          result.push(...decodeInlineHtml(fragment, baseUrl));
          break;
        }
        default:
          text(token.raw);
          break;
      }
    }
    return result;
  };
  const blocks = (tokens: readonly Token[], depth: number): MarkdownBlock[] => {
    const result: MarkdownBlock[] = [];
    let tableStyle: "tuack" | undefined;
    for (const [index, token] of tokens.entries()) {
      budget(depth);
      switch (token.type) {
        case "checkbox":
          break;
        case "space":
        case "def":
          break;
        case "heading":
          result.push({
            type: "heading",
            level: token.depth,
            children: inlines(token.tokens ?? [], depth + 1),
          });
          break;
        case "paragraph":
        case "text": {
          let next = index + 1;
          while (tokens[next]?.type === "space") next++;
          if (
            isTableStyleDirective(token.raw) &&
            tokens[next]?.type === "table"
          ) {
            tableStyle = "tuack";
            break;
          }
          const children = inlines(
            token.tokens ?? parser.Lexer.lexInline(token.text),
            depth + 1,
          );
          if (children.length === 1 && children[0]?.type === "image-inline") {
            const { type: _type, ...image } = children[0];
            result.push({ type: "image", ...image });
          } else if (children.length) {
            const paragraph: MarkdownBlock = { type: "paragraph", children };
            if (/^:{3,}/.test(token.raw.trim()))
              directiveCandidates.add(paragraph);
            result.push(paragraph);
          }
          break;
        }
        case "code":
          if (token.lang === MATH_CODE_LANGUAGE) {
            const code = parseMathCode(token.text);
            for (const line of code.lines ?? []) {
              budget(depth + 1);
              for (const _node of line) budget(depth + 1);
            }
            result.push(code);
            break;
          }
          result.push({
            type: "code",
            value: token.text,
            ...(token.lang ? { language: token.lang } : {}),
          });
          break;
        case "math-block":
          result.push({ type: "math", value: token.text });
          break;
        case "hr":
          result.push({ type: "thematic-break" });
          break;
        case "blockquote":
          result.push({
            type: "quote",
            blocks: blocks(token.tokens ?? [], depth + 1),
          });
          break;
        case "list":
          result.push({
            type: "list",
            ordered: token.ordered,
            ...(token.ordered && token.start !== 1
              ? { start: token.start }
              : {}),
            items: token.items.map((item: Tokens.ListItem) => ({
              ...(item.task ? { checked: !!item.checked } : {}),
              children: blocks(item.tokens, depth + 1),
            })),
          });
          break;
        case "table":
          result.push(
            mergeMarkdownTable(
              {
                type: "table",
                headers: token.header.map((cell: Tokens.TableCell) =>
                  inlines(cell.tokens, depth + 1),
                ),
                rows: token.rows.map((row: Tokens.TableCell[]) =>
                  row.map((cell) => inlines(cell.tokens, depth + 1)),
                ),
                ...(token.align.some(Boolean)
                  ? { alignments: token.align }
                  : {}),
                ...(tableStyle ? { style: tableStyle } : {}),
              },
              [token.header, ...token.rows].map((row: Tokens.TableCell[]) =>
                row.map((cell) => cell.text),
              ),
            ),
          );
          tableStyle = undefined;
          break;
        case "html": {
          const decoded = htmlToAst(token.raw, baseUrl);
          result.push(...decoded.blocks);
          warnings.push(...decoded.warnings);
          break;
        }
        default:
          throw new Error(`不支持的 Markdown 语法：${token.type}`);
      }
    }
    return result;
  };
  const ast: MarkdownRoot = {
    type: "root",
    children: parseMarkdownDirectives(
      blocks(parser.lexer(markdown), 0),
      directiveCandidates,
    ),
  };
  return { ast, assets: markdownAssets(ast), warnings };
}

/** Resource discovery follows the current syntax tree, never an earlier source tree. */
export function markdownAssets(ast: MarkdownRoot): readonly ProblemAsset[] {
  const assets = new Map<string, ProblemAsset>();
  const inline = (nodes: readonly InlineNode[]) => {
    for (const node of nodes) {
      if (node.type === "image-inline")
        assets.set(node.url, {
          sourceUrl: node.url,
          alt: node.alt,
          ...(node.width ? { width: node.width } : {}),
          ...(node.height ? { height: node.height } : {}),
        });
      else if ("children" in node) inline(node.children);
    }
  };
  const visit = (nodes: readonly MarkdownBlock[]) => {
    for (const node of nodes) {
      if (node.type === "image")
        assets.set(node.url, {
          sourceUrl: node.url,
          alt: node.alt,
          ...(node.width ? { width: node.width } : {}),
          ...(node.height ? { height: node.height } : {}),
        });
      if ("blocks" in node) visit(node.blocks);
      if ("children" in node) inline(node.children);
      if (node.type === "list")
        node.items.forEach((item) => visit(item.children));
      if (node.type === "table") {
        node.headers.forEach(inline);
        node.rows.forEach((row) => row.forEach(inline));
      }
      if (node.type === "code") node.lines?.forEach(inline);
    }
  };
  visit(ast.children);
  return [...assets.values()];
}
