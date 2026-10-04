import type { HttpClient, InstanceBrandingRecord } from "../../domain";
import { hydroScopedUrl } from "../../domain/hydro-scope";
import { assertHydroScopeResponse } from "./session";

export interface HydroBrandingParseResult {
  iconUrls: string[];
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    const key = match[1]?.toLowerCase();
    if (key) result[key] = decodeHtml(match[3] ?? "");
  }
  return result;
}

export function parseHydroBrandingHtml(
  text: string,
  responseUrl: string,
): HydroBrandingParseResult {
  const icons: Array<{ href: string; priority: number; sizeDistance: number }> =
    [];
  const iconPattern = /<link\b([^>]+)>/gi;
  for (const match of text.matchAll(iconPattern)) {
    const linkAttrs = attributes(match[0] ?? "");
    const rel = linkAttrs.rel ?? "";
    if (!/(?:^|\s)(?:icon|shortcut\s+icon|apple-touch-icon)(?:\s|$)/i.test(rel))
      continue;
    const href = linkAttrs.href;
    if (href && !/svg/i.test(linkAttrs.type ?? "")) {
      const sizes =
        (linkAttrs.sizes ?? "")
          .match(/\d+(?=x)/gi)
          ?.map(Number)
          .filter((size) => size >= 16) ?? [];
      icons.push({
        href,
        priority: /apple-touch-icon/i.test(rel)
          ? 2
          : /shortcut/i.test(rel)
            ? 1
            : 0,
        sizeDistance: sizes.length
          ? Math.min(...sizes.map((size) => Math.abs(size - 32)))
          : 100,
      });
    }
  }
  const candidates = icons
    .sort((a, b) => a.priority - b.priority || a.sizeDistance - b.sizeDistance)
    .map((item) => item.href);
  for (const match of text.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0] ?? "");
    if (attrs.property?.toLowerCase() === "og:image" && attrs.content) {
      candidates.push(attrs.content);
    }
  }
  candidates.push("/favicon.ico", "/favicon-32x32.png", "/favicon-96x96.png");
  const origin = new URL(responseUrl).origin;
  const iconUrls = candidates.flatMap((href) => {
    try {
      const url = new URL(decodeHtml(href), responseUrl);
      return url.origin === origin && !url.username && !url.password
        ? [url.href]
        : [];
    } catch {
      return [];
    }
  });
  return {
    iconUrls: [...new Set(iconUrls)].slice(0, 8),
  };
}

function iconMime(bytes: Uint8Array, contentType: string): string | undefined {
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase();
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (
    mime === "image/png" &&
    starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  )
    return mime;
  if (mime === "image/jpeg" && starts(0xff, 0xd8, 0xff)) return mime;
  if (
    mime === "image/gif" &&
    /^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0, 6)))
  )
    return mime;
  if (
    mime === "image/webp" &&
    starts(0x52, 0x49, 0x46, 0x46) &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return mime;
  if (
    (mime === "image/x-icon" || mime === "image/vnd.microsoft.icon") &&
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    bytes[2] === 1 &&
    bytes[3] === 0
  )
    return mime;
  return undefined;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoder = (
    globalThis as typeof globalThis & { btoa?: (value: string) => string }
  ).btoa;
  if (!encoder) throw new Error("btoa unavailable");
  return encoder(binary);
}

export async function fetchHydroBranding(
  http: HttpClient,
  input: {
    origin: string;
    domainId?: string;
    source: "hydroj";
    credentials?: RequestCredentials;
    cookie?: string;
    signal: AbortSignal;
    maxBytes?: number;
    now?: number;
  },
): Promise<InstanceBrandingRecord> {
  const root = await http.request("hydroj", hydroScopedUrl(input), {
    credentials: input.credentials ?? "include",
    signal: input.signal,
    headers: {
      Accept: "text/html",
      ...(input.cookie ? { Cookie: input.cookie } : {}),
    },
    hydroOrigin: input.origin,
    followRedirects: true,
  });
  if (
    new URL(root.url).origin !== new URL(input.origin).origin ||
    (root.status !== 401 && (root.status < 200 || root.status >= 300))
  )
    throw new Error("Branding unavailable");
  assertHydroScopeResponse(input, root);
  const parsed = parseHydroBrandingHtml(root.text, root.url);
  let iconDataUrl: string | undefined;
  let iconFetchedAt: number | undefined;
  for (const iconUrl of parsed.iconUrls) {
    if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const icon = await http.request("hydroj", iconUrl, {
        responseType: "bytes",
        maxBytes: input.maxBytes ?? 64 * 1024,
        credentials: input.credentials ?? "include",
        ...(input.cookie ? { headers: { Cookie: input.cookie } } : {}),
        signal: input.signal,
        hydroOrigin: input.origin,
        followRedirects: true,
      });
      const bytes = icon.bytes ?? new Uint8Array();
      if (
        icon.status < 200 ||
        icon.status >= 300 ||
        new URL(icon.url).origin !== new URL(input.origin).origin ||
        bytes.length > (input.maxBytes ?? 64 * 1024)
      )
        continue;
      const mime = iconMime(bytes, icon.contentType);
      if (!mime) continue;
      iconDataUrl = `data:${mime};base64,${base64(bytes)}`;
      iconFetchedAt = input.now ?? Date.now();
      break;
    } catch {
      // Try the next same-origin candidate; branding is non-critical.
    }
  }
  return {
    source: "hydroj",
    origin: input.origin,
    ...(input.domainId ? { domainId: input.domainId } : {}),
    name: "HydroOJ",
    ...(iconDataUrl ? { iconDataUrl } : {}),
    fetchedAt: input.now ?? Date.now(),
    ...(iconFetchedAt ? { iconFetchedAt } : {}),
  };
}
