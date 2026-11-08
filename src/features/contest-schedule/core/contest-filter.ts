import { contestPhaseAt, hasCompleteTiming } from "./contest-status";
import { FINISHED_WINDOW_MS, UPCOMING_WINDOW_MS } from "./contest-status";
import { endTimeOf, localDateKey } from "./contest-time";
import type {
  Contest,
  ContestPhaseFilter,
  ContestPlatform,
  ContestRecord,
} from "./types";

export interface ContestFilterOptions {
  platform: ContestPlatform | "all";
  phase: ContestPhaseFilter;
}

export type ContestSectionKey = "running" | "upcoming" | "finished";

export interface ContestSection {
  key: ContestSectionKey;
  contests: Contest[];
}

export interface ContestDateGroup {
  key: string;
  date: number;
  contests: Contest[];
}

export function deduplicateContests(
  contests: readonly ContestRecord[],
): ContestRecord[] {
  const byKey = new Map<string, ContestRecord>();
  for (const contest of contests) {
    const key = `${contest.platform}:${contest.id}`;
    const current = byKey.get(key);
    if (
      !current ||
      (hasCompleteTiming(contest) && !hasCompleteTiming(current)) ||
      (hasCompleteTiming(contest) === hasCompleteTiming(current) &&
        contest.fetchedAt > current.fetchedAt)
    )
      byKey.set(key, contest);
  }
  return [...byKey.values()];
}

export function buildContestSchedule(
  contests: readonly ContestRecord[],
  now: number,
  options: ContestFilterOptions = { platform: "all", phase: "all" },
): Contest[] {
  return buildContestSections(contests, now, options).flatMap(
    (section) => section.contests,
  );
}

export function buildContestSections(
  contests: readonly ContestRecord[],
  now: number,
  options: ContestFilterOptions = { platform: "all", phase: "all" },
): ContestSection[] {
  const groups: Record<ContestSectionKey, Contest[]> = {
    running: [],
    upcoming: [],
    finished: [],
  };
  for (const record of deduplicateContests(contests)) {
    const phase = contestPhaseAt(record, now);
    const timingComplete = hasCompleteTiming(record);
    if (
      (options.platform !== "all" && record.platform !== options.platform) ||
      (options.phase === "unknown" && timingComplete) ||
      (options.phase !== "all" &&
        options.phase !== "unknown" &&
        phase !== options.phase)
    )
      continue;

    const contest: Contest = {
      ...record,
      phase,
      timingComplete,
    };
    if (phase === "running") groups.running.push(contest);
    else if (
      phase === "upcoming" &&
      record.startTime <= now + UPCOMING_WINDOW_MS
    )
      groups.upcoming.push(contest);
    else if (phase === "finished") {
      const endTime = endTimeOf(record);
      if (endTime !== undefined && now - endTime <= FINISHED_WINDOW_MS)
        groups.finished.push(contest);
    }
  }

  groups.running.sort(
    (a, b) =>
      (endTimeOf(a) ?? Number.POSITIVE_INFINITY) -
        (endTimeOf(b) ?? Number.POSITIVE_INFINITY) ||
      a.startTime - b.startTime ||
      a.platform.localeCompare(b.platform) ||
      a.id.localeCompare(b.id),
  );
  groups.upcoming.sort(
    (a, b) =>
      a.startTime - b.startTime ||
      a.platform.localeCompare(b.platform) ||
      a.id.localeCompare(b.id),
  );
  groups.finished.sort(
    (a, b) =>
      (endTimeOf(b) ?? 0) - (endTimeOf(a) ?? 0) ||
      a.platform.localeCompare(b.platform) ||
      a.id.localeCompare(b.id),
  );

  return (Object.keys(groups) as ContestSectionKey[])
    .map((key) => ({ key, contests: groups[key] }))
    .filter((section) => section.contests.length > 0);
}

export function groupContestSectionByDate(
  contests: readonly Contest[],
  section: ContestSectionKey,
): ContestDateGroup[] {
  const grouped = new Map<string, ContestDateGroup>();
  for (const contest of contests) {
    const timestamp =
      section !== "upcoming"
        ? (endTimeOf(contest) ?? contest.startTime)
        : contest.startTime;
    const key = localDateKey(timestamp);
    const group = grouped.get(key) ?? { key, date: timestamp, contests: [] };
    group.contests.push(contest);
    grouped.set(key, group);
  }
  return [...grouped.values()];
}
