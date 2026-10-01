export type CustomOriginError =
  | "invalid_url"
  | "https_required"
  | "http_not_allowed"
  | "credentials_not_allowed"
  | "root_origin_required"
  | "public_host_required";

export class CustomOriginValidationError extends Error {
  constructor(public readonly code: CustomOriginError) {
    super(code);
    this.name = "CustomOriginValidationError";
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
  ) {
    return false;
  }
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!value.includes(":")) return false;
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    if (mapped.includes(".")) return isPrivateIpv4(mapped);
    const groups = mapped.split(":");
    if (
      groups.length === 2 &&
      groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))
    ) {
      const first = Number.parseInt(groups[0]!, 16);
      const second = Number.parseInt(groups[1]!, 16);
      return isPrivateIpv4(
        [first >> 8, first & 255, second >> 8, second & 255].join("."),
      );
    }
    return true;
  }
  const firstGroup = Number.parseInt(value.split(":")[0] || "0", 16);
  return (
    (firstGroup & 0xfe00) === 0xfc00 ||
    (firstGroup & 0xffc0) === 0xfe80 ||
    (firstGroup & 0xff00) === 0xff00
  );
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example")
  ) {
    return false;
  }
  if (isPrivateIpv6(host)) return false;
  if (/^[0-9.]+$/.test(host)) return !isPrivateIpv4(host);
  return host.includes(".");
}

/** Normalize a user-entered HydroOJ address to an exact origin. */
export function normalizeCustomHttpsOrigin(
  rawValue: string,
  options: { allowHttp?: boolean } = {},
): string {
  let url: URL;
  try {
    url = new URL(rawValue.trim());
  } catch {
    throw new CustomOriginValidationError("invalid_url");
  }
  if (
    url.protocol !== "https:" &&
    !(options.allowHttp && url.protocol === "http:")
  ) {
    throw new CustomOriginValidationError("https_required");
  }
  if (url.username || url.password) {
    throw new CustomOriginValidationError("credentials_not_allowed");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new CustomOriginValidationError("root_origin_required");
  }
  if (!isPublicHostname(url.hostname)) {
    throw new CustomOriginValidationError("public_host_required");
  }
  return url.origin;
}

/** Chrome MV3 accepts exact origins in permissions.request when declared as optional host access. */
export function exactOriginPermissionPattern(
  origin: string,
  options: { allowHttp?: boolean } = {},
): string {
  const normalized = normalizeCustomHttpsOrigin(origin, options);
  return `${normalized}/*`;
}
