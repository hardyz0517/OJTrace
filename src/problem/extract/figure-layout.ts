import type { MarkdownBlock } from "../markdown/ast";

export function inferFigureCaptions(
  blocks: readonly MarkdownBlock[],
): MarkdownBlock[] {
  return captionPass(blocks, false);
}

/**
 * Text under an image, including a following centered note, is a caption.
 * A normal paragraph after that note stays body size.
 */
function captionPass(
  blocks: readonly MarkdownBlock[],
  inFigure: boolean,
): MarkdownBlock[] {
  let afterImage = false;
  const marked: MarkdownBlock[] = [];
  for (const block of blocks) {
    if (block.type === "image") {
      afterImage = true;
      marked.push(block);
      continue;
    }
    if (block.type === "figure") {
      const current = {
        ...block,
        blocks: captionPass(block.blocks, true),
      };
      afterImage = endsWithImage(current);
      marked.push(current);
      continue;
    }
    if (block.type === "align" || block.type === "quote") {
      const current = {
        ...block,
        blocks: captionPass(block.blocks, block.type === "align"),
      };
      if (afterImage && isTextOnlyAlign(current)) {
        marked.push({
          ...current,
          blocks: current.blocks.map((inner) =>
            inner.type === "paragraph" ? { ...inner, caption: true } : inner,
          ),
        });
        afterImage = false;
        continue;
      }
      afterImage = endsWithImage(current);
      marked.push(current);
      continue;
    }
    if (inFigure && afterImage && block.type === "paragraph") {
      marked.push({ ...block, caption: true });
      continue;
    }
    afterImage = false;
    marked.push(block);
  }
  return marked;
}

function isTextOnlyAlign(
  block: MarkdownBlock,
): block is Extract<MarkdownBlock, { type: "align" }> {
  return (
    block.type === "align" &&
    block.blocks.length > 0 &&
    block.blocks.every((inner) => inner.type === "paragraph")
  );
}

function endsWithImage(block: MarkdownBlock | undefined): boolean {
  if (!block) return false;
  if (block.type === "image") return true;
  if (
    block.type === "align" ||
    block.type === "quote" ||
    block.type === "figure"
  )
    return endsWithImage(block.blocks[block.blocks.length - 1]);
  return false;
}
