import { normalizeCustomHttpsOrigin } from "../../platform/permissions/custom-origin";

/** Default HydroOJ website origin, identified from the official project links. */
export const HYDROOJ_OFFICIAL_ORIGIN = "https://hydro.ac";

export type HydroOJOrigin = string;

export interface HydroOJInstance {
  origin: string;
  kind: "official" | "custom";
}

export function createHydroOJInstance(rawOrigin?: string): HydroOJInstance {
  const origin = rawOrigin
    ? normalizeCustomHttpsOrigin(rawOrigin, { allowHttp: true })
    : HYDROOJ_OFFICIAL_ORIGIN;
  return {
    origin,
    kind: origin === HYDROOJ_OFFICIAL_ORIGIN ? "official" : "custom",
  };
}

export function hydroOJRecordsUrl(
  origin: string,
  usernameOrUid: string,
  page = 1,
): string {
  const normalizedOrigin = normalizeCustomHttpsOrigin(origin, {
    allowHttp: true,
  });
  if (!usernameOrUid.trim())
    throw new Error("HydroOJ account identifier is required");
  if (!Number.isSafeInteger(page) || page < 1)
    throw new Error("HydroOJ page is invalid");
  const url = new URL("/record", normalizedOrigin);
  url.searchParams.set("uidOrName", usernameOrUid.trim());
  url.searchParams.set("page", String(page));
  return url.href;
}

export function hydroOJActivityRecordsUrl(
  origin: string,
  activityId: string,
  uidOrName: string,
  page = 1,
): string {
  if (!/^[0-9a-f]{24}$/i.test(activityId))
    throw new Error("HydroOJ activity id is invalid");
  const url = new URL(hydroOJRecordsUrl(origin, uidOrName, page));
  url.searchParams.set("tid", activityId);
  return url.href;
}

export function hydroOJUserUrl(origin: string, uid: string): string {
  const normalizedOrigin = normalizeCustomHttpsOrigin(origin, {
    allowHttp: true,
  });
  if (!/^\d+$/.test(uid)) throw new Error("HydroOJ UID is invalid");
  return new URL(`/user/${encodeURIComponent(uid)}`, normalizedOrigin).href;
}
