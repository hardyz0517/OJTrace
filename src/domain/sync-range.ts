import type { SyncRangePreference } from "./types";

export const MAX_SYNC_LOOKBACK_DAYS = 35;

export function isSyncRangePreference(
  value: unknown,
): value is SyncRangePreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const range = value as Partial<SyncRangePreference>;
  return (
    typeof range.from === "number" &&
    Number.isFinite(range.from) &&
    range.from >= 0 &&
    typeof range.to === "number" &&
    Number.isFinite(range.to) &&
    range.from <= range.to &&
    typeof range.followNow === "boolean" &&
    (range.preset === undefined ||
      range.preset === "today" ||
      [1, 7, 14, 30].includes(range.preset as number))
  );
}
