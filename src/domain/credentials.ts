import type { AccountCredentials } from "./types";

/** Shared entry shape; callers decide whether to reject or filter bad entries. */
export function isCredentialEntry(
  key: string,
  value: unknown,
): value is string {
  return key.length > 0 && typeof value === "string" && !/[\r\n]/.test(value);
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_ATTRIBUTE_NAMES = new Set([
  "domain",
  "expires",
  "httponly",
  "max-age",
  "path",
  "samesite",
  "secure",
]);

/** Return a trimmed credential without exposing a missing value as an empty string. */
export function credentialValue(
  credentials: AccountCredentials | undefined,
  key: string,
): string | undefined {
  const value = credentials?.[key]?.trim();
  return value || undefined;
}

/**
 * Normalize a user supplied Cookie header. Invalid pairs and Set-Cookie
 * attributes are discarded so adapters never accidentally send them back.
 */
export function normalizeCookieHeader(
  raw: string | undefined,
): string | undefined {
  if (!raw || /[\r\n]/.test(raw)) return undefined;
  const entries = new Map<string, string>();
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (
      !COOKIE_NAME.test(name) ||
      COOKIE_ATTRIBUTE_NAMES.has(name.toLowerCase()) ||
      !value ||
      /[\r\n;]/.test(value)
    ) {
      continue;
    }
    entries.set(name, value);
  }
  return entries.size
    ? [...entries].map(([name, value]) => `${name}=${value}`).join("; ")
    : undefined;
}

/**
 * Read a full Cookie field first, then compose a Cookie header from named
 * credential fields. Each adapter can declare the fields it requires.
 */
export function cookieHeaderFromCredentials(
  credentials: AccountCredentials | undefined,
  fieldNames: readonly string[],
): string | undefined {
  const full = fieldNames.includes("cookie")
    ? normalizeCookieHeader(credentialValue(credentials, "cookie"))
    : undefined;
  if (full) return full;

  const fields = fieldNames
    .filter((name) => name !== "cookie")
    .flatMap((name) => {
      const value = credentialValue(credentials, name);
      return value && COOKIE_NAME.test(name) && !/[\r\n;]/.test(value)
        ? [`${name}=${value}`]
        : [];
    });
  return fields.length ? fields.join("; ") : undefined;
}
