import type { ContestRecord } from "./types";

/** Prefer the source duration when both end representations are available. */
export function endTimeOf(
  contest: Pick<ContestRecord, "startTime" | "durationSeconds" | "endTime">,
): number | undefined {
  if (
    Number.isFinite(contest.durationSeconds) &&
    contest.durationSeconds! > 0
  ) {
    const endTime = contest.startTime + contest.durationSeconds! * 1_000;
    if (Number.isSafeInteger(endTime) && endTime > contest.startTime)
      return endTime;
  }
  if (Number.isFinite(contest.endTime) && contest.endTime! > contest.startTime)
    return contest.endTime;
  return undefined;
}

/** Format an epoch timestamp as a stable local-time date and minute. */
export function formatContestDateTime(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
