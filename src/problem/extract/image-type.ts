/**
 * Types the PDF renderer can embed, and the suffix of the Typst virtual path.
 * WebP is intentionally absent. SVG stays declared-only because the text
 * sniffer misses valid files. PNG, JPEG, and GIF must also match their bytes.
 */
const IMAGE_FILE_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
} as const;

type EmbeddableImageType = keyof typeof IMAGE_FILE_EXTENSIONS;

export function imageFileExtension(mimeType: string): string | undefined {
  if (!isEmbeddableImageType(mimeType)) return undefined;
  return IMAGE_FILE_EXTENSIONS[mimeType];
}

function isEmbeddableImageType(value: string): value is EmbeddableImageType {
  return Object.hasOwn(IMAGE_FILE_EXTENSIONS, value);
}

/**
 * Accept a declared image type, or recognize PNG/JPEG/GIF/SVG bytes when a CDN
 * omits the content type. An explicit non-image type is rejected so an HTML
 * error page cannot be embedded as a picture.
 */
export function embeddableImageType(
  declared: string | null | undefined,
  bytes: Uint8Array,
): string | undefined {
  const normalized = declared?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const canonical = normalized === "image/jpg" ? "image/jpeg" : normalized;
  if (canonical === "image/svg+xml") return canonical;
  if (isEmbeddableImageType(canonical))
    return sniffImageType(bytes) === canonical ? canonical : undefined;
  if (
    canonical &&
    canonical !== "application/octet-stream" &&
    canonical !== "binary/octet-stream" &&
    canonical !== "application/binary"
  )
    return undefined;
  return sniffImageType(bytes);
}

function sniffImageType(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  )
    return "image/gif";
  const head = new TextDecoder()
    .decode(bytes.subarray(0, 200))
    .trimStart()
    .toLowerCase();
  if (
    head.startsWith("<svg") ||
    (head.startsWith("<?xml") && head.includes("<svg"))
  )
    return "image/svg+xml";
  return undefined;
}
