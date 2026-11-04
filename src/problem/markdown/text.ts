import type { InlineNode } from "./ast";
export function inlineText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "inline-code":
        case "inline-math":
          return node.value;
        case "strong":
        case "delete":
        case "emphasis":
        case "link":
          return inlineText(node.children);
        case "image-inline":
          return node.alt;
        case "break":
          return " ";
      }
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
