import type { ContestPhase, ContestRecord } from "./types";
import { endTimeOf } from "./contest-time";

export const UPCOMING_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
export const FINISHED_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export { endTimeOf } from "./contest-time";

export function contestPhaseAt(
  contest: ContestRecord,
  now: number,
): ContestPhase {
  if (!Number.isFinite(contest.startTime) || !Number.isFinite(now))
    return "unknown";
  if (now < contest.startTime) return "upcoming";
  const endTime = endTimeOf(contest);
  if (endTime !== undefined) return now < endTime ? "running" : "finished";
  return "unknown";
}

export function hasCompleteTiming(
  contest: Pick<ContestRecord, "startTime" | "durationSeconds" | "endTime">,
): boolean {
  return endTimeOf(contest) !== undefined;
}

/** Default range is based on end time, so long contests are never hidden by start date. */
export function isInDefaultSchedule(
  contest: ContestRecord,
  now: number,
): boolean {
  if (!Number.isFinite(contest.startTime) || !Number.isFinite(now))
    return false;
  const endTime = endTimeOf(contest);
  if (now < contest.startTime)
    return contest.startTime <= now + UPCOMING_WINDOW_MS;
  if (endTime !== undefined) {
    if (now < endTime) return true;
    return now - endTime <= FINISHED_WINDOW_MS;
  }
  // A source-confirmed running contest has no reliable end. Keep it visible,
  // but expose the missing timing to the UI rather than inventing a duration.
  return contestPhaseAt(contest, now) === "running";
}
