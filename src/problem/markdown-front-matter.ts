/** Bound metadata work while the user is editing an unfinished YAML header. */
export const FRONT_MATTER_LIMIT = 16_384;

export interface FrontMatterRange {
  contentFrom: number;
  contentTo: number;
  to: number;
  bodyFrom: number;
  closed: boolean;
}

/** Only a document-leading --- block is metadata; body separators stay Markdown. */
export function frontMatterRange(source: string): FrontMatterRange | undefined {
  const opening = /^(?:\uFEFF)?---[\t ]*\r?\n/.exec(source);
  if (!opening) return undefined;
  const close = /^---[\t ]*\r?$/gm;
  close.lastIndex = opening[0].length;
  const closing = close.exec(source.slice(0, FRONT_MATTER_LIMIT + 1));
  const to = closing ? closing.index + closing[0].length : 0;
  if (
    !closing ||
    to > FRONT_MATTER_LIMIT ||
    (source[to] !== undefined && source[to] !== "\n")
  )
    return {
      contentFrom: opening[0].length,
      contentTo: Math.min(source.length, FRONT_MATTER_LIMIT),
      to: Math.min(source.length, FRONT_MATTER_LIMIT),
      bodyFrom: source.length,
      closed: false,
    };
  return {
    contentFrom: opening[0].length,
    contentTo: closing.index,
    to,
    bodyFrom: to + (source[to] === "\n" ? 1 : 0),
    closed: true,
  };
}
