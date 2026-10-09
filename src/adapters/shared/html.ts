/** Preserve site parser decoding order, including one pass over nested entities. */
export function decodeHtml(
  value: string,
  options: { nonBreakingSpace?: boolean } = {},
): string {
  const named = value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  return (
    options.nonBreakingSpace === false ? named : named.replace(/&nbsp;/g, " ")
  )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}
