import type { ContestRecord } from "../../core/types";
import {
  ContestProviderError,
  isObject,
  unixSecondsToMilliseconds,
} from "../types";

export function parseCodeforcesContests(
  value: unknown,
  fetchedAt = Date.now(),
): ContestRecord[] {
  if (!isObject(value) || value.status !== "OK" || !Array.isArray(value.result))
    throw new ContestProviderError(
      "codeforces",
      "invalid-response",
      "Codeforces 比赛列表响应格式无效。",
    );

  const contests = value.result.flatMap((item): ContestRecord[] => {
    if (!isObject(item)) return [];
    const startTime = unixSecondsToMilliseconds(item.startTimeSeconds);
    if (
      !Number.isSafeInteger(item.id) ||
      (item.id as number) <= 0 ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      startTime === undefined
    )
      return [];
    const durationSeconds =
      typeof item.durationSeconds === "number" &&
      Number.isSafeInteger(item.durationSeconds) &&
      item.durationSeconds > 0
        ? item.durationSeconds
        : undefined;
    return [
      {
        id: String(item.id),
        platform: "codeforces",
        title: item.name.trim(),
        url: `https://codeforces.com/contest/${item.id}`,
        startTime,
        ...(durationSeconds === undefined
          ? {}
          : { durationSeconds, endTime: startTime + durationSeconds * 1_000 }),
        ...(typeof item.phase === "string" ? { sourcePhase: item.phase } : {}),
        fetchedAt,
      },
    ];
  });
  if (value.result.length > 0 && contests.length === 0)
    throw new ContestProviderError(
      "codeforces",
      "invalid-response",
      "Codeforces 比赛列表没有可识别的比赛记录。",
    );
  return contests;
}
