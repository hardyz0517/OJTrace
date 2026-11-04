import type { ImageFrame, InlineNode, MarkdownBlock, CodeBlock } from "./ast";

function htmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function imageHtml(
  image: ImageFrame & { url: string; alt: string },
): string {
  const styles = [
    image.widthRatio != null ? `width:${image.widthRatio * 100}%` : "",
    image.zoom != null ? `zoom:${image.zoom}` : "",
    image.maxWidthRatio != null
      ? `max-width:${image.maxWidthRatio * 100}%`
      : image.maxWidthPx != null
        ? `max-width:${image.maxWidthPx}px`
        : "",
    image.maxHeightRatio != null
      ? `max-height:${image.maxHeightRatio * 100}%`
      : image.maxHeightPx != null
        ? `max-height:${image.maxHeightPx}px`
        : "",
  ]
    .filter(Boolean)
    .join(";");
  return `<img src="${htmlText(image.url)}" alt="${htmlText(image.alt)}"${image.title != null ? ` title="${htmlText(image.title)}"` : ""}${image.width != null ? ` width="${image.width}"` : ""}${image.height != null ? ` height="${image.height}"` : ""}${styles ? ` style="${styles}"` : ""}>`;
}

export function inlineHtml(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node): string => {
      switch (node.type) {
        case "text":
          return `<span data-ojtrace-text="true">${literalHtml(node.value)}</span>`;
        case "strong":
          return `<strong>${inlineHtml(node.children)}</strong>`;
        case "delete":
          return `<del>${inlineHtml(node.children)}</del>`;
        case "emphasis":
          return `<em>${inlineHtml(node.children)}</em>`;
        case "link":
          return `<a href="${htmlText(node.url)}"${node.title != null ? ` title="${htmlText(node.title)}"` : ""}>${inlineHtml(node.children)}</a>`;
        case "inline-code":
          return `<code>${htmlText(node.value)}</code>`;
        case "inline-math":
          return `<span data-math="${htmlText(node.value)}"${node.display ? ' class="math-display"' : ""}></span>`;
        case "image-inline":
          return imageHtml(node);
        case "break":
          return "<br>";
      }
    })
    .join("");
}

/** Inline HTML can still pass through Markdown's inline math tokenizer. */
export function literalHtml(value: string): string {
  return htmlText(value).replaceAll("$", "&#36;").replaceAll("\\", "&#92;");
}

export function codeHtml(block: CodeBlock): string {
  const content = block.lines?.some((line) =>
    line.some((node) => node.type === "inline-math"),
  )
    ? block.lines.map(inlineHtml).join("\n")
    : htmlText(block.value);
  return `<pre data-ojtrace-code="exact"${block.caption != null ? ` data-caption="${htmlText(block.caption)}"` : ""}><code${block.language != null ? ` class="language-${htmlText(block.language)}"` : ""}>${content}</code></pre>`;
}

export function blockHtml(block: MarkdownBlock): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${inlineHtml(block.children)}</h${block.level}>`;
    case "paragraph":
      return `<p${block.caption ? ' data-ojtrace-caption="true"' : ""}>${inlineHtml(block.children)}</p>`;
    case "code":
      return codeHtml(block);
    case "math":
      return `<div class="math-display" data-math="${htmlText(block.value)}"></div>`;
    case "image":
      return imageHtml(block);
    case "table": {
      const rows = block.headers.length
        ? [block.headers, ...block.rows]
        : block.rows;
      return `<table data-ojtrace-table="${block.style ?? "plain"}">${rows
        .map(
          (row, r) =>
            `<tr>${row
              .map((cell, c) => {
                const span = block.spans?.[r]?.[c];
                const tag = r === 0 && block.headers.length ? "th" : "td";
                return `<${tag}${span === null ? ' data-ojtrace-covered="true"' : span ? ` colspan="${span.colspan}" rowspan="${span.rowspan}"` : ""}${block.alignments?.[c] ? ` align="${block.alignments[c]}"` : ""}>${inlineHtml(cell)}</${tag}>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</table>`;
    }
    case "list":
      return `<${block.ordered ? "ol" : "ul"} data-ojtrace-list="true"${block.start != null ? ` start="${block.start}"` : ""}>${block.items.map((item) => `<li${item.checked != null ? ` data-ojtrace-checked="${item.checked}"` : ""}>${item.children.map(blockHtml).join("")}</li>`).join("")}</${block.ordered ? "ol" : "ul"}>`;
    case "quote":
      return `<blockquote>${block.blocks.map(blockHtml).join("")}</blockquote>`;
    case "align":
      return `<div data-ojtrace-align="${block.align}">${block.blocks.map(blockHtml).join("")}</div>`;
    case "figure":
      return `<div data-ojtrace-figure="true"${block.caption != null ? ` data-caption="${htmlText(block.caption)}"` : ""}>${block.blocks.map(blockHtml).join("")}</div>`;
    case "thematic-break":
      return "<hr>";
  }
}
