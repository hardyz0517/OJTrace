import type { SourceId } from "../../domain";
import { adapterBySource } from "../../adapters";
import {
  exactOriginPermissionPattern,
  normalizeCustomHttpsOrigin,
} from "./custom-origin";

export const SOURCE_ORIGINS: Record<SourceId, string[]> = {
  codeforces: ["https://codeforces.com/*"],
  luogu: ["https://www.luogu.com.cn/*"],
  qoj: ["https://qoj.ac/*"],
  atcoder: ["https://atcoder.jp/*"],
  hydroj: [],
};

export async function hasSourcePermission(source: SourceId): Promise<boolean> {
  return browser.permissions.contains({ origins: SOURCE_ORIGINS[source] });
}

export async function requestSourcePermission(
  source: SourceId,
): Promise<boolean> {
  return browser.permissions.request({ origins: SOURCE_ORIGINS[source] });
}

export async function hasExactOriginPermission(
  origin: string,
): Promise<boolean> {
  return browser.permissions.contains({
    origins: [
      exactOriginPermissionPattern(
        normalizeCustomHttpsOrigin(origin, { allowHttp: true }),
        { allowHttp: true },
      ),
    ],
  });
}

export async function requestExactOriginPermission(
  origin: string,
): Promise<boolean> {
  return browser.permissions.request({
    origins: [
      exactOriginPermissionPattern(
        normalizeCustomHttpsOrigin(origin, { allowHttp: true }),
        { allowHttp: true },
      ),
    ],
  });
}

export async function ensureSourcePermission(
  source: SourceId,
): Promise<boolean> {
  if (await hasSourcePermission(source)) return true;
  return requestSourcePermission(source);
}

/** The same permission plan is used by user-gesture requests and background checks. */
export function authorizationOrigins(
  source: SourceId,
  origin?: string,
): string[] {
  return [
    ...new Set([
      ...(source === "hydroj" && origin
        ? [exactOriginPermissionPattern(origin, { allowHttp: true })]
        : SOURCE_ORIGINS[source]),
      ...(adapterBySource.get(source)?.metadata.dataOrigins ?? []),
    ]),
  ];
}

export async function ensureAuthorizationPermission(
  source: SourceId,
  origin?: string,
  request = false,
): Promise<boolean> {
  const origins = authorizationOrigins(source, origin);
  // Request directly inside the UI click stack; requesting an already granted
  // pattern succeeds without showing another prompt.
  if (request) return browser.permissions.request({ origins });
  if (await browser.permissions.contains({ origins })) return true;
  return false;
}

/** Request the source host plus any adapter-owned public data origins. */
export async function ensureAdapterDataPermission(
  source: SourceId,
  options: { includeSource?: boolean; origins?: readonly string[] } = {},
): Promise<boolean> {
  const origins = [
    ...(options.includeSource === false ? [] : SOURCE_ORIGINS[source]),
    ...(options.origins ??
      adapterBySource.get(source)?.metadata.dataOrigins ??
      []),
  ];
  if (await browser.permissions.contains({ origins })) return true;
  return browser.permissions.request({ origins });
}

export function isAllowedNavigation(source: SourceId, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && source !== "hydroj") return false;
    return SOURCE_ORIGINS[source].some((pattern) => {
      const origin = new URL(pattern.replace("/*", "")).origin;
      return url.origin === origin;
    });
  } catch {
    return false;
  }
}

export function isAllowedOriginNavigation(
  source: SourceId,
  origin: string,
  rawUrl: string,
): boolean {
  try {
    return (
      new URL(rawUrl).origin ===
      normalizeCustomHttpsOrigin(origin, { allowHttp: true })
    );
  } catch {
    return false;
  }
}
