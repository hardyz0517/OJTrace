import { normalizeOrigin } from "./account-identity";
import { normalizeHydroDomainId } from "./hydro-scope";
import type { SyncWindow } from "./sync-range";

/** Unknown timing replaces older timing; failures never produce an observation. */
export interface ActivityScheduleRecord {
  source: "hydroj";
  origin: string;
  domainId?: string;
  activityId: string;
  beginAt?: number;
  endAt?: number;
  checkedAt: number;
}

export const ACTIVITY_SCHEDULE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_ACTIVITY_SCHEDULES = 512;

export function activityScheduleKey(
  scope: Pick<ActivityScheduleRecord, "origin" | "domainId" | "activityId">,
): string {
  if (!/^[0-9a-f]{24}$/i.test(scope.activityId))
    throw new Error("Invalid activity ID");
  return JSON.stringify([
    "hydroj",
    normalizeOrigin(scope.origin),
    normalizeHydroDomainId(scope.domainId) ?? null,
    scope.activityId.toLowerCase(),
  ]);
}

function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function sanitizeActivitySchedule(
  value: unknown,
): ActivityScheduleRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const item = value as Record<string, unknown>;
  if (
    item.source !== "hydroj" ||
    typeof item.origin !== "string" ||
    typeof item.activityId !== "string" ||
    !/^[0-9a-f]{24}$/i.test(item.activityId) ||
    !timestamp(item.checkedAt)
  )
    return;
  try {
    const origin = normalizeOrigin(item.origin);
    const domainId = normalizeHydroDomainId(
      item.domainId as string | undefined,
    );
    if (!origin) return;
    const validTiming =
      timestamp(item.beginAt) &&
      timestamp(item.endAt) &&
      item.beginAt < item.endAt;
    return {
      source: "hydroj",
      origin,
      ...(domainId === undefined ? {} : { domainId }),
      activityId: item.activityId.toLowerCase(),
      checkedAt: item.checkedAt,
      ...(validTiming
        ? { beginAt: item.beginAt as number, endAt: item.endAt as number }
        : {}),
    };
  } catch {
    return;
  }
}

export function updateActivityScheduleCache(
  current: Record<string, ActivityScheduleRecord>,
  incoming: readonly ActivityScheduleRecord[],
): Record<string, ActivityScheduleRecord> {
  const cache = new Map<string, ActivityScheduleRecord>();
  for (const raw of [...Object.values(current), ...incoming]) {
    const item = sanitizeActivitySchedule(raw);
    if (!item) continue;
    const key = activityScheduleKey(item);
    if (item.checkedAt >= (cache.get(key)?.checkedAt ?? -1))
      cache.set(key, item);
  }
  return Object.fromEntries(
    [...cache.entries()]
      .sort((a, b) => b[1].checkedAt - a[1].checkedAt)
      .slice(0, MAX_ACTIVITY_SCHEDULES),
  );
}

export function isActivityOutsideWindow(
  schedule: ActivityScheduleRecord | undefined,
  window: SyncWindow,
  now: number,
): boolean {
  return Boolean(
    schedule &&
    timestamp(schedule.beginAt) &&
    timestamp(schedule.endAt) &&
    schedule.beginAt < schedule.endAt &&
    schedule.endAt < window.since &&
    now >= schedule.checkedAt &&
    now - schedule.checkedAt < ACTIVITY_SCHEDULE_TTL_MS,
  );
}
