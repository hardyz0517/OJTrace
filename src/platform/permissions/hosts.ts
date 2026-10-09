import { SOURCE_IDS, type SourceId } from "../../domain";
import { sourceDefinitions } from "../../sources/definitions";
import { isHydroScopeUrl } from "../../domain/hydro-scope";
import {
  exactOriginPermissionPattern,
  normalizeCustomHttpsOrigin,
} from "./custom-origin";

export const SOURCE_ORIGINS = SOURCE_IDS.reduce<Record<SourceId, string[]>>(
  (origins, source) => {
    const origin = sourceDefinitions[source].fixedOrigin;
    origins[source] = origin ? [`${origin}/*`] : [];
    return origins;
  },
  {} as Record<SourceId, string[]>,
);

export async function hasSourcePermission(source: SourceId): Promise<boolean> {
  return browser.permissions.contains({ origins: SOURCE_ORIGINS[source] });
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
      ...(sourceDefinitions[source].metadata.dataOrigins ?? []),
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
      sourceDefinitions[source].metadata.dataOrigins ??
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
  domainId?: string,
): boolean {
  try {
    return (
      source === "hydroj" &&
      isHydroScopeUrl(
        {
          origin: normalizeCustomHttpsOrigin(origin, { allowHttp: true }),
          domainId,
        },
        rawUrl,
      )
    );
  } catch {
    return false;
  }
}
