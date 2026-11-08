import type { ContestRecord } from "../../core/types";
import {
  ContestProviderError,
  isObject,
  unixSecondsToMilliseconds,
} from "../types";

export interface LuoguContestPage {
  contests: ContestRecord[];
  perPage: number;
  total: number;
  sourceRowCount: number;
}

export function parseLuoguContestPage(
  html: string,
  fetchedAt = Date.now(),
): LuoguContestPage {
  const context = html.match(
    /<script\b(?=[^>]*\bid=["']lentille-context["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!context)
    throw new ContestProviderError(
      "luogu",
      "invalid-response",
      "洛谷比赛列表缺少公开数据。",
    );
  let value: unknown;
  try {
    value = JSON.parse(context);
  } catch {
    throw new ContestProviderError(
      "luogu",
      "invalid-response",
      "洛谷比赛列表数据不是有效 JSON。",
    );
  }
  if (
    !isObject(value) ||
    !isObject(value.data) ||
    !isObject(value.data.contests) ||
    !Array.isArray(value.data.contests.result)
  )
    throw new ContestProviderError(
      "luogu",
      "invalid-response",
      "洛谷比赛列表数据结构无效。",
    );
  const contests = value.data.contests.result.flatMap(
    (item): ContestRecord[] => {
      if (!isObject(item)) return [];
      const startTime = unixSecondsToMilliseconds(item.startTime);
      const endTime = unixSecondsToMilliseconds(item.endTime);
      if (
        !Number.isSafeInteger(item.id) ||
        (item.id as number) <= 0 ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        startTime === undefined
      )
        return [];
      const problemCount =
        Number.isSafeInteger(item.problemCount) &&
        (item.problemCount as number) > 0
          ? (item.problemCount as number)
          : undefined;
      const rated =
        Number.isSafeInteger(item.rated) && (item.rated as number) >= 0
          ? (item.rated as number)
          : undefined;
      const evaluation =
        rated === undefined
          ? undefined
          : {
              rating: (rated & 1) !== 0,
              estimate: (rated & 2) !== 0,
            };
      return [
        {
          id: String(item.id),
          platform: "luogu",
          title: item.name.trim(),
          url: `https://www.luogu.com.cn/contest/${item.id}`,
          startTime,
          ...(endTime !== undefined && endTime > startTime
            ? { endTime, durationSeconds: (endTime - startTime) / 1_000 }
            : {}),
          ...(problemCount === undefined ? {} : { problemCount }),
          ...(evaluation === undefined ? {} : { evaluation }),
          fetchedAt,
        },
      ];
    },
  );
  if (value.data.contests.result.length > 0 && contests.length === 0)
    throw new ContestProviderError(
      "luogu",
      "invalid-response",
      "洛谷比赛列表没有可识别的比赛记录。",
    );
  return {
    contests,
    perPage:
      Number.isSafeInteger(value.data.contests.perPage) &&
      (value.data.contests.perPage as number) > 0
        ? (value.data.contests.perPage as number)
        : 20,
    total:
      Number.isSafeInteger(value.data.contests.count) &&
      (value.data.contests.count as number) >= 0
        ? (value.data.contests.count as number)
        : contests.length,
    sourceRowCount: value.data.contests.result.length,
  };
}
