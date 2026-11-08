const HANDLE_PATTERN = `[A-Za-z0-9_.-]{1,32}`;

/** Read the signed-in AtCoder account marker from an official HTML page. */
export function parseAtCoderSessionHandle(html: string): string | undefined {
  const candidates = [
    new RegExp(
      `(?:var\\s+)?userScreenName\\s*=\\s*["'](${HANDLE_PATTERN})["']`,
      "i",
    ).exec(html)?.[1],
    new RegExp(
      `<a\\b[^>]*href=["']\\/users\\/(${HANDLE_PATTERN})["'][^>]*>[\\s\\S]{0,240}?My\\s+Profile`,
      "i",
    ).exec(html)?.[1],
  ];
  return candidates.find((candidate) => candidate !== undefined);
}
