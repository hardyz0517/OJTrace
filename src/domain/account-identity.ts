import type { SourceId } from "./types";
import { normalizeHydroDomainId } from "./hydro-scope";

export class AccountIdentityError extends Error {
  constructor(
    public readonly code:
      "invalid-origin" | "origin-required" | "invalid-provider-key",
  ) {
    super(code);
    this.name = "AccountIdentityError";
  }
}

export function normalizeOrigin(origin?: string): string {
  if (!origin) return "";
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new AccountIdentityError("invalid-origin");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AccountIdentityError("invalid-origin");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new AccountIdentityError("invalid-origin");
  }
  return url.origin;
}

export function normalizeProviderAccountKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || /[\r\n]/.test(normalized)) {
    throw new AccountIdentityError("invalid-provider-key");
  }
  return normalized;
}

function tupleKey(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("");
}

export function buildIdentityKey(input: {
  source: SourceId;
  origin?: string;
  domainId?: string;
  providerAccountKey: string;
}): string {
  const scope = input.source === "hydroj" ? normalizeOrigin(input.origin) : "";
  if (input.source === "hydroj" && !scope) {
    throw new AccountIdentityError("origin-required");
  }
  if (
    input.source !== "hydroj" &&
    (input.origin !== undefined || input.domainId !== undefined)
  ) {
    throw new AccountIdentityError("invalid-origin");
  }
  const domainId = normalizeHydroDomainId(input.domainId);
  return tupleKey([
    input.source,
    scope,
    ...(domainId === undefined ? [] : [domainId]),
    normalizeProviderAccountKey(input.providerAccountKey),
  ]);
}

export function instanceBrandingKey(
  source: SourceId,
  origin: string,
  domainId?: string,
): string {
  const normalized = normalizeOrigin(origin);
  if (source !== "hydroj" || !normalized) {
    throw new AccountIdentityError("invalid-origin");
  }
  const domain = normalizeHydroDomainId(domainId);
  return tupleKey([source, normalized, ...(domain ? [domain] : [])]);
}
