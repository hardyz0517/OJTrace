import { normalizeCustomHttpsOrigin } from "../../platform/permissions/custom-origin";
import {
  normalizeHydroDomainId,
  hydroScopedUrl,
} from "../../domain/hydro-scope";

/** Default HydroOJ website origin, identified from the official project links. */
export const HYDROOJ_OFFICIAL_ORIGIN = "https://hydro.ac";

export type HydroOJOrigin = string;

export interface HydroOJInstance {
  origin: string;
  domainId?: string;
  kind: "official" | "custom";
}

export function createHydroOJInstance(
  rawOrigin = HYDROOJ_OFFICIAL_ORIGIN,
  explicitDomainId?: string,
): HydroOJInstance {
  const address = rawOrigin.trim();
  // URL normalizes dot segments and backslashes; never let that select root scope.
  if (address.includes("\\") || /\/(?:\.|%2e){1,2}(?:\/|$)/i.test(address))
    throw new Error("Invalid Hydro address");
  const url = new URL(address);
  const origin = normalizeCustomHttpsOrigin(`${url.protocol}//${url.host}`, {
    allowHttp: true,
  });
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Invalid Hydro address");
  const match = url.pathname.match(/^\/d\/([^/]+)\/?$/);
  if (url.pathname !== "/" && !match)
    throw new Error("Expected Hydro root or domain address");
  const pathDomainId = match
    ? normalizeHydroDomainId(decodeURIComponent(match[1]!))
    : undefined;
  const domainId = normalizeHydroDomainId(explicitDomainId) ?? pathDomainId;
  if (pathDomainId && domainId !== pathDomainId)
    throw new Error("Conflicting Hydro domain ids");
  return {
    origin,
    ...(domainId === undefined ? {} : { domainId }),
    kind: origin === HYDROOJ_OFFICIAL_ORIGIN ? "official" : "custom",
  };
}

export function hydroOJRecordsUrl(
  origin: string,
  usernameOrUid: string,
  page = 1,
  domainId?: string,
): string {
  const instance = createHydroOJInstance(origin, domainId);
  if (!usernameOrUid.trim())
    throw new Error("HydroOJ account identifier is required");
  if (!Number.isSafeInteger(page) || page < 1)
    throw new Error("HydroOJ page is invalid");
  const url = new URL(hydroScopedUrl(instance, "/record"));
  url.searchParams.set("uidOrName", usernameOrUid.trim());
  url.searchParams.set("page", String(page));
  return url.href;
}

export function hydroOJActivityRecordsUrl(
  origin: string,
  activityId: string,
  uidOrName: string,
  page = 1,
  domainId?: string,
): string {
  if (!/^[0-9a-f]{24}$/i.test(activityId))
    throw new Error("HydroOJ activity id is invalid");
  const url = new URL(hydroOJRecordsUrl(origin, uidOrName, page, domainId));
  url.searchParams.set("tid", activityId);
  return url.href;
}

export function hydroOJUserUrl(
  origin: string,
  uid: string,
  domainId?: string,
): string {
  const instance = createHydroOJInstance(origin, domainId);
  if (!/^\d+$/.test(uid)) throw new Error("HydroOJ UID is invalid");
  return hydroScopedUrl(instance, `/user/${encodeURIComponent(uid)}`);
}
