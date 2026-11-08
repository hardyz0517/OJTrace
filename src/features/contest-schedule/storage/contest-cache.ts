import type {
  ContestCache,
  ContestPlatform,
  ContestRecord,
} from "../core/types";

export interface ContestCacheStorage {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

export const CONTEST_CACHE_KEYS: Record<ContestPlatform, string> = {
  luogu: "ojtrace:contest-schedule:luogu",
  codeforces: "ojtrace:contest-schedule:codeforces",
  atcoder: "ojtrace:contest-schedule:atcoder",
};

const CACHE_SCHEMA_VERSION = 1 as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validContestUrl(
  platform: ContestPlatform,
  value: unknown,
): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const originByPlatform: Record<ContestPlatform, string> = {
      luogu: "https://www.luogu.com.cn",
      codeforces: "https://codeforces.com",
      atcoder: "https://atcoder.jp",
    };
    const pathPattern: Record<ContestPlatform, RegExp> = {
      luogu: /^\/contest\/[\w-]+\/?$/,
      codeforces: /^\/contest\/\d+\/?$/,
      atcoder: /^\/contests\/[\w-]+\/?$/,
    };
    return (
      url.origin === originByPlatform[platform] &&
      pathPattern[platform].test(url.pathname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function sanitizeContest(
  value: unknown,
  platform: ContestPlatform,
): ContestRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    !value.id.trim() ||
    value.id.length > 100 ||
    value.platform !== platform ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 500 ||
    !validContestUrl(platform, value.url) ||
    !isTimestamp(value.startTime) ||
    !isTimestamp(value.fetchedAt)
  )
    return undefined;
  const durationSeconds =
    typeof value.durationSeconds === "number" &&
    Number.isSafeInteger(value.durationSeconds) &&
    value.durationSeconds > 0
      ? value.durationSeconds
      : undefined;
  const endTime =
    isTimestamp(value.endTime) && value.endTime > value.startTime
      ? value.endTime
      : undefined;
  const problemCount =
    typeof value.problemCount === "number" &&
    Number.isSafeInteger(value.problemCount) &&
    value.problemCount > 0
      ? value.problemCount
      : undefined;
  const evaluation =
    isRecord(value.evaluation) &&
    typeof value.evaluation.rating === "boolean" &&
    typeof value.evaluation.estimate === "boolean"
      ? {
          rating: value.evaluation.rating,
          estimate: value.evaluation.estimate,
        }
      : undefined;
  return {
    id: value.id,
    platform,
    title: value.title.trim(),
    url: value.url,
    startTime: value.startTime,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(endTime === undefined ? {} : { endTime }),
    ...(problemCount === undefined ? {} : { problemCount }),
    ...(evaluation === undefined ? {} : { evaluation }),
    ...(typeof value.ratedRange === "string" && value.ratedRange.length <= 100
      ? { ratedRange: value.ratedRange }
      : {}),
    ...(typeof value.sourcePhase === "string" && value.sourcePhase.length <= 40
      ? { sourcePhase: value.sourcePhase }
      : {}),
    fetchedAt: value.fetchedAt,
  };
}

export function sanitizeContestCache(
  value: unknown,
  platform: ContestPlatform,
): ContestCache | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CACHE_SCHEMA_VERSION ||
    value.platform !== platform ||
    !isTimestamp(value.lastSuccessAt) ||
    !Array.isArray(value.contests)
  )
    return undefined;
  const contests = value.contests
    .map((contest) => sanitizeContest(contest, platform))
    .filter((contest): contest is ContestRecord => Boolean(contest));
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    platform,
    contests,
    lastSuccessAt: value.lastSuccessAt,
    ...(Number.isSafeInteger(value.contestDataVersion) &&
    (value.contestDataVersion as number) > 0
      ? { contestDataVersion: value.contestDataVersion as number }
      : {}),
    ...(isTimestamp(value.problemCountsCheckedAt)
      ? { problemCountsCheckedAt: value.problemCountsCheckedAt }
      : {}),
  };
}

export async function loadContestCache(
  storage: ContestCacheStorage,
  platform: ContestPlatform,
): Promise<ContestCache | undefined> {
  const key = CONTEST_CACHE_KEYS[platform];
  const values = await storage.get(key);
  return sanitizeContestCache(values[key], platform);
}

export async function saveContestCache(
  storage: ContestCacheStorage,
  platform: ContestPlatform,
  cache: ContestCache,
): Promise<void> {
  const safe = sanitizeContestCache(cache, platform);
  if (!safe) throw new Error("无法保存无效赛程缓存。");
  await storage.set({ [CONTEST_CACHE_KEYS[platform]]: safe });
}
