export function resolveResourceUrl(
  value: string | undefined,
  baseUrl: string,
): string | undefined {
  const raw = value?.trim();
  if (!raw || /^(?:data|blob|javascript|vbscript):/i.test(raw))
    return undefined;
  try {
    const url = new URL(raw, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
