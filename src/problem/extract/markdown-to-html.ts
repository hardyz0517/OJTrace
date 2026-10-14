import { Marked, type Tokens } from "marked";

function mathToken(source: string, block: boolean): Tokens.Generic | undefined {
  const prefix = block ? (source.match(/^ {0,3}/)?.[0] ?? "") : "";
  const value = source.slice(prefix.length);
  const open = ["$$", "\\[", "\\(", "$"].find((marker) =>
    value.startsWith(marker),
  );
  if (!open || (block && open !== "$$" && open !== "\\[")) return undefined;
  const close = open === "\\[" ? "\\]" : open === "\\(" ? "\\)" : open;
  let end = open.length;
  while ((end = value.indexOf(close, end)) >= 0) {
    let slashes = 0;
    for (
      let cursor = end - 1;
      cursor >= 0 && value[cursor] === "\\";
      cursor -= 1
    )
      slashes += 1;
    if (slashes % 2 === 0) break;
    end += close.length;
  }
  if (end < 0) return undefined;
  const text = value.slice(open.length, end).trim();
  if (!text || (open === "$" && text.includes("\n"))) return undefined;
  const raw = prefix + value.slice(0, end + close.length);
  return {
    type: block ? "statement-math-block" : "statement-math-inline",
    raw,
    text,
    display: open === "$$" || open === "\\[",
  };
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Tokenize math before emphasis/escaping so x_i and TeX commands survive
// Markdown parsing. HTML is consumed only by the shared, inert AST extractor.
const parser = new Marked({
  async: false,
  gfm: true,
  extensions: [
    {
      name: "statement-math-inline",
      level: "inline",
      start(source) {
        return source.search(/\$|\\[([]/);
      },
      tokenizer(source) {
        return mathToken(source, false);
      },
      renderer(token) {
        return `<span${token.display ? ' class="math-display"' : ""} data-math="${escapeAttribute(token.text)}"></span>`;
      },
    },
    {
      name: "statement-math-block",
      level: "block",
      start(source) {
        return source.search(/^ {0,3}(?:\$\$|\\\[)/m);
      },
      tokenizer(source) {
        return mathToken(source, true);
      },
      renderer(token) {
        return `<div class="math-display" data-math="${escapeAttribute(token.text)}"></div>\n`;
      },
    },
  ],
});

export function markdownToHtml(markdown: string): string {
  return parser.parse(markdown, { async: false });
}
