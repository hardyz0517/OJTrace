import type { SyncRangePreference } from "./types";

export const MAX_SYNC_LOOKBACK_DAYS = 35;
export const DEFAULT_SYNC_LOOKBACK_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_SYNC_LOOKBACK_MS = DEFAULT_SYNC_LOOKBACK_DAYS * DAY_MS;

/** Inclusive, frozen millisecond window used throughout a collection task. */
export interface SyncWindow {
  readonly since: number;
  readonly until: number;
}

export class SyncRangeError extends Error {
  readonly code = "invalid_sync_range";

  constructor(message: string) {
    super(message);
    this.name = "SyncRangeError";
  }
}

function isTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Explicit invalid windows are rejected; they are never silently widened. */
export function validateSyncWindow(
  window: SyncWindow,
  now: number,
): SyncWindow {
  if (
    !isTimestamp(now) ||
    !isTimestamp(window.since) ||
    !isTimestamp(window.until) ||
    window.since > window.until ||
    window.until > now ||
    window.since < Math.max(0, now - MAX_SYNC_LOOKBACK_DAYS * DAY_MS)
  ) {
    throw new SyncRangeError("Sync window must be within the last 35 days");
  }
  return Object.freeze({ since: window.since, until: window.until });
}

export function resolveSyncWindow(input: {
  now: number;
  since?: number;
  until?: number;
  preference?: SyncRangePreference;
}): SyncWindow {
  const { now, since, until, preference } = input;
  let window: SyncWindow;
  if (since !== undefined || until !== undefined) {
    const end = until ?? now;
    window = {
      since: since ?? Math.max(0, end - DEFAULT_SYNC_LOOKBACK_MS),
      until: end,
    };
  } else if (preference) {
    if (!isSyncRangePreference(preference)) {
      throw new SyncRangeError("Saved sync window is invalid");
    }
    window = resolveSyncRangePreference(preference, now);
  } else {
    window = { since: Math.max(0, now - DEFAULT_SYNC_LOOKBACK_MS), until: now };
  }
  return validateSyncWindow(window, now);
}

/** Match the Timeline: shortcuts roll, a custom following range keeps its start. */
export function resolveSyncRangePreference(
  preference: SyncRangePreference,
  now: number,
): SyncWindow {
  if (!preference.followNow) {
    return { since: preference.from, until: preference.to };
  }
  if (preference.preset === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return { since: midnight.getTime(), until: now };
  }
  return {
    since:
      preference.preset === undefined
        ? preference.from
        : Math.max(0, now - preference.preset * DAY_MS),
    until: now,
  };
}

export function isWithinSyncWindow(
  submittedAt: number,
  window: SyncWindow,
): boolean {
  return (
    isTimestamp(submittedAt) &&
    submittedAt >= window.since &&
    submittedAt <= window.until
  );
}

export function isSyncRangePreference(
  value: unknown,
): value is SyncRangePreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const range = value as Partial<SyncRangePreference>;
  return (
    typeof range.from === "number" &&
    Number.isSafeInteger(range.from) &&
    range.from >= 0 &&
    typeof range.to === "number" &&
    Number.isSafeInteger(range.to) &&
    range.from <= range.to &&
    typeof range.followNow === "boolean" &&
    (range.preset === undefined ||
      range.preset === "today" ||
      [1, 7, 14, 30].includes(range.preset as number))
  );
}
