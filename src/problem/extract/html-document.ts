import { decodeHtml } from "../../adapters/shared/html";

export interface HtmlTextNode {
  type: "text";
  value: string;
  parent?: HtmlElementNode;
}

export interface HtmlElementNode {
  type: "element";
  tagName: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent?: HtmlElementNode;
}

export interface HtmlRootNode {
  type: "root";
  children: HtmlNode[];
}

export type HtmlNode = HtmlTextNode | HtmlElementNode;

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAW_TEXT_TAGS = new Set(["script", "style"]);

export function parseHtmlDocument(html: string): HtmlRootNode {
  const root: HtmlRootNode = { type: "root", children: [] };
  const stack: HtmlElementNode[] = [];
  let cursor = 0;
  const append = (node: HtmlNode): void => {
    const parent = stack[stack.length - 1];
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      root.children.push(node);
    }
  };

  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open < 0) {
      append({ type: "text", value: safeDecode(html.slice(cursor)) });
      break;
    }
    if (open > cursor) {
      append({ type: "text", value: safeDecode(html.slice(cursor, open)) });
    }
    if (html.startsWith("<!--", open)) {
      const endComment = html.indexOf("-->", open + 4);
      cursor = endComment < 0 ? html.length : endComment + 3;
      continue;
    }
    const end = findTagEnd(html, open + 1);
    if (end < 0) {
      append({ type: "text", value: safeDecode(html.slice(open)) });
      break;
    }
    const rawTag = html.slice(open + 1, end).trim();
    if (
      !rawTag ||
      rawTag.startsWith("!DOCTYPE") ||
      rawTag.startsWith("!doctype")
    ) {
      cursor = end + 1;
      continue;
    }
    if (rawTag.startsWith("/")) {
      const closingName = rawTag
        .slice(1)
        .trim()
        .toLowerCase()
        .split(/\s/, 1)[0];
      const index = stack
        .map((item) => item.tagName)
        .lastIndexOf(closingName ?? "");
      if (index >= 0) stack.length = index;
      cursor = end + 1;
      continue;
    }
    const selfClosing = /\/\s*$/.test(rawTag);
    const source = selfClosing ? rawTag.replace(/\/\s*$/, "") : rawTag;
    const nameMatch = source.match(/^([^\s/>]+)/);
    if (!nameMatch?.[1]) {
      cursor = end + 1;
      continue;
    }
    const tagName = nameMatch[1].toLowerCase();
    const attrs = parseAttributes(source.slice(nameMatch[0].length));
    const element: HtmlElementNode = {
      type: "element",
      tagName,
      attrs,
      children: [],
    };
    append(element);
    cursor = end + 1;
    if (!selfClosing && !VOID_TAGS.has(tagName)) {
      stack.push(element);
      if (RAW_TEXT_TAGS.has(tagName)) {
        const close = html.toLowerCase().indexOf(`</${tagName}`, cursor);
        if (close > cursor) {
          element.children.push({
            type: "text",
            value: html.slice(cursor, close),
            parent: element,
          });
          const closeEnd = html.indexOf(">", close);
          cursor = closeEnd < 0 ? html.length : closeEnd + 1;
          stack.pop();
        }
      }
    }
  }
  return root;
}

function findTagEnd(html: string, start: number): number {
  let quote = "";
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    attrs[name] = safeDecode(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

export function findAll(
  node: HtmlRootNode | HtmlElementNode,
  predicate: (element: HtmlElementNode) => boolean,
): HtmlElementNode[] {
  const result: HtmlElementNode[] = [];
  const visit = (current: HtmlRootNode | HtmlElementNode): void => {
    for (const child of current.children) {
      if (child.type !== "element") continue;
      if (predicate(child)) result.push(child);
      visit(child);
    }
  };
  visit(node);
  return result;
}

export function findFirst(
  node: HtmlRootNode | HtmlElementNode,
  predicate: (element: HtmlElementNode) => boolean,
): HtmlElementNode | undefined {
  return findAll(node, predicate)[0];
}

export function hasClass(node: HtmlElementNode, name: string): boolean {
  return (node.attrs.class ?? "").split(/\s+/).includes(name);
}

export function textContent(node: HtmlNode | HtmlRootNode): string {
  if (node.type === "text") return node.value;
  return node.children.map(textContent).join("");
}

export function trimmedText(node: HtmlNode | HtmlRootNode): string {
  return textContent(node)
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function attr(node: HtmlElementNode, name: string): string | undefined {
  const value = node.attrs[name.toLowerCase()];
  return value?.trim() || undefined;
}

export function serializeNode(node: HtmlNode | HtmlRootNode): string {
  if (node.type === "text") {
    // The adapter round-trips this representation through parseHtmlDocument.
    // Preserve raw-text element payloads (notably TeX scripts), but encode
    // ordinary decoded text so it cannot become markup on the second parse.
    if (node.parent && RAW_TEXT_TAGS.has(node.parent.tagName))
      return node.value;
    return node.value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  const children = node.children.map(serializeNode).join("");
  if (node.type === "root") return children;
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join("");
  return VOID_TAGS.has(node.tagName)
    ? `<${node.tagName}${attrs}>`
    : `<${node.tagName}${attrs}>${children}</${node.tagName}>`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeDecode(value: string): string {
  try {
    return decodeHtml(value);
  } catch {
    // Malformed numeric entities must not make an otherwise usable statement
    // fail to export. Keep their source text when the shared decoder rejects it.
    return value;
  }
}

export function removeNodes(
  root: HtmlRootNode | HtmlElementNode,
  predicate: (element: HtmlElementNode) => boolean,
): void {
  const clean = (parent: HtmlRootNode | HtmlElementNode): void => {
    parent.children = parent.children.filter((child) => {
      if (child.type !== "element") return true;
      if (predicate(child)) return false;
      clean(child);
      return true;
    });
  };
  clean(root);
}
