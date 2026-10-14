const typstMarkupEscapes: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  "#": "\\#",
  $: "\\$",
  "*": "\\*",
  _: "\\_",
  "`": "\\`",
  "[": "\\[",
  "]": "\\]",
  "<": "\\<",
  ">": "\\>",
  "@": "\\@",
  "~": "\\~",
  "=": "\\=",
  "-": "\\-",
  "+": "\\+",
  "/": "\\/",
};

/** Escape untrusted plain text for insertion into Typst markup content. */
export function escapeTypstContent(value: string): string {
  return value.replace(
    /[\\#$*_`\x5b\x5d<>@~=+\x2f\x2d]/g,
    (character) => typstMarkupEscapes[character] ?? character,
  );
}

/** Encode a string literal used by Typst functions such as `#raw` and `#link`. */
export function typstStringLiteral(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "\\n")}"`;
}
