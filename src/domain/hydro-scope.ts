/** Website transport is origin-scoped; collection may target one Hydro domain. */
export interface HydroScope {
  origin: string;
  domainId?: string;
}

export function isHydroDomainId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function normalizeHydroDomainId(value?: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isHydroDomainId(value)) throw new Error("Invalid Hydro domain id");
  return value;
}

export function hydroDomainPrefix(domainId?: string): string {
  const id = normalizeHydroDomainId(domainId);
  return id === undefined ? "" : `/d/${id}`;
}

/** Read a route's explicit domain without guessing the host's default domain. */
export function hydroDomainFromUrl(url: string): string | undefined {
  const path = new URL(url).pathname;
  if (!path.startsWith("/d/")) return undefined;
  const match = path.match(/^\/d\/([^/]+)(?:\/|$)/);
  if (!match) throw new Error("Invalid Hydro domain route");
  return normalizeHydroDomainId(decodeURIComponent(match[1]!));
}

export function hydroScopedUrl(scope: HydroScope, route = "/"): string {
  if (!route.startsWith("/") || route.startsWith("//"))
    throw new Error("Invalid Hydro route");
  return new URL(`${hydroDomainPrefix(scope.domainId)}${route}`, scope.origin)
    .href;
}

export function isHydroScopeUrl(scope: HydroScope, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.origin === scope.origin &&
      !url.username &&
      !url.password &&
      hydroDomainFromUrl(url.href) === scope.domainId
    );
  } catch {
    return false;
  }
}
