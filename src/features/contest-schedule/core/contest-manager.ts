import {
  CONTEST_DATA_VERSION,
  CONTEST_PLATFORMS,
  type ContestCache,
  type ContestPlatform,
  type ContestProviderMap,
  type ContestProblemCountProviderMap,
  type ContestRecord,
  type ContestRefreshResult,
} from "./types";
import {
  CONTEST_CACHE_KEYS,
  loadContestCache,
  saveContestCache,
  type ContestCacheStorage,
} from "../storage/contest-cache";

const CONTEST_REQUEST_ATTEMPTS_KEY =
  "ojtrace:contest-schedule:request-attempts";
const CONTEST_REFRESH_COOLDOWN_MS = 30_000;

export function createContestManager(
  storage: ContestCacheStorage,
  providers: ContestProviderMap,
  problemCountProviders: ContestProblemCountProviderMap = {},
) {
  const lastRequestedAt: Partial<Record<ContestPlatform, number>> = {};
  let restoreAttempts: Promise<void> | undefined;
  let attemptWriteTail = Promise.resolve();
  const refreshInFlight: Partial<
    Record<ContestPlatform, Promise<ContestRefreshResult>>
  > = {};
  // A contest page can be open in several tabs at once.  Keep optional
  // problem-count enrichment single-flight per platform so those tabs do not
  // all download the same large public mapping concurrently.
  const enrichInFlight: Partial<Record<ContestPlatform, Promise<void>>> = {};

  function ensureAttemptsRestored(): Promise<void> {
    restoreAttempts ??= storage
      .get(CONTEST_REQUEST_ATTEMPTS_KEY)
      .then((stored) => {
        const value = stored[CONTEST_REQUEST_ATTEMPTS_KEY];
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        for (const platform of CONTEST_PLATFORMS) {
          const timestamp = (value as Record<string, unknown>)[platform];
          if (typeof timestamp === "number" && Number.isSafeInteger(timestamp))
            lastRequestedAt[platform] = timestamp;
        }
      })
      .catch(() => undefined);
    return restoreAttempts;
  }

  function persistAttempt(
    platform: ContestPlatform,
    now: number,
  ): Promise<void> {
    lastRequestedAt[platform] = now;
    const snapshot = { ...lastRequestedAt };
    const write = attemptWriteTail.then(() =>
      storage.set({ [CONTEST_REQUEST_ATTEMPTS_KEY]: snapshot }),
    );
    attemptWriteTail = write.catch(() => undefined);
    return write.catch(() => undefined);
  }
  async function load(): Promise<
    Partial<Record<ContestPlatform, ContestCache>>
  > {
    const entries = await Promise.all(
      CONTEST_PLATFORMS.map(
        async (platform) =>
          [platform, await loadContestCache(storage, platform)] as const,
      ),
    );
    return Object.fromEntries(
      entries.filter((entry): entry is typeof entry & { 1: ContestCache } =>
        Boolean(entry[1]),
      ),
    );
  }

  async function refresh(
    enabledPlatforms: readonly ContestPlatform[] = CONTEST_PLATFORMS,
    now = Date.now(),
  ): Promise<{
    caches: Partial<Record<ContestPlatform, ContestCache>>;
    results: ContestRefreshResult[];
  }> {
    await ensureAttemptsRestored();
    const enabled = new Set(enabledPlatforms);
    const results = await Promise.all(
      CONTEST_PLATFORMS.map(async (platform): Promise<ContestRefreshResult> => {
        if (!enabled.has(platform))
          return {
            platform,
            status: "permission-required",
            message: "请先允许访问该 OJ。",
          };
        const running = refreshInFlight[platform];
        if (running) return running;
        const previousRequest = lastRequestedAt[platform];
        if (
          previousRequest !== undefined &&
          now - previousRequest < CONTEST_REFRESH_COOLDOWN_MS
        )
          return {
            platform,
            status: "failed",
            message: "请求过于频繁，请稍后再刷新。",
          };
        const operation = (async (): Promise<ContestRefreshResult> => {
          try {
            await persistAttempt(platform, now);
            const contests = await providers[platform]();
            const previous = await loadContestCache(storage, platform);
            const previousById = new Map(
              previous?.contests.map((contest) => [contest.id, contest]) ?? [],
            );
            const stamped: ContestRecord[] = contests.map((contest) => ({
              ...contest,
              ...(contest.problemCount === undefined &&
              previousById.get(contest.id)?.problemCount !== undefined
                ? { problemCount: previousById.get(contest.id)!.problemCount }
                : {}),
              ...(contest.evaluation === undefined &&
              previousById.get(contest.id)?.evaluation !== undefined
                ? { evaluation: previousById.get(contest.id)!.evaluation }
                : {}),
              fetchedAt: now,
            }));
            const cache: ContestCache = {
              schemaVersion: 1,
              platform,
              contests: stamped,
              lastSuccessAt: now,
              contestDataVersion: CONTEST_DATA_VERSION,
              ...(previous?.problemCountsCheckedAt === undefined
                ? {}
                : { problemCountsCheckedAt: previous.problemCountsCheckedAt }),
            };
            await saveContestCache(storage, platform, cache);
            return {
              platform,
              status: "success",
              contestCount: stamped.length,
            };
          } catch (error) {
            return {
              platform,
              status: "failed",
              message:
                error instanceof Error ? error.message : "获取比赛列表失败。",
            };
          }
        })();
        refreshInFlight[platform] = operation;
        try {
          return await operation;
        } finally {
          delete refreshInFlight[platform];
        }
      }),
    );
    return { caches: await load(), results };
  }

  async function enrichProblemCounts(
    platforms: readonly ContestPlatform[],
    now = Date.now(),
    force = false,
  ): Promise<Partial<Record<ContestPlatform, ContestCache>>> {
    async function enrichPlatform(platform: ContestPlatform): Promise<void> {
      const running = enrichInFlight[platform];
      if (running) {
        await running;
        return;
      }
      const operation = (async (): Promise<void> => {
        const provider = problemCountProviders[platform];
        const cache = await loadContestCache(storage, platform);
        if (!provider || !cache) return;
        const checkedAt = cache.problemCountsCheckedAt;
        if (
          !force &&
          checkedAt !== undefined &&
          now - checkedAt < 6 * 60 * 60 * 1_000
        )
          return;
        const candidates = force
          ? cache.contests
          : cache.contests.filter(
              (contest) => contest.problemCount === undefined,
            );
        if (candidates.length === 0) return;
        try {
          const counts = await provider(
            candidates.map((contest) => contest.id),
          );
          const latest = await loadContestCache(storage, platform);
          if (!latest) return;
          const signature = (value: ContestCache) =>
            value.contests
              .map((contest) => `${contest.id}:${contest.fetchedAt}`)
              .sort()
              .join("|");
          if (
            latest.lastSuccessAt !== cache.lastSuccessAt ||
            signature(latest) !== signature(cache)
          )
            return;
          const updated: ContestCache = {
            ...latest,
            contests: latest.contests.map((contest) => {
              const count = counts.get(contest.id);
              return count !== undefined &&
                Number.isSafeInteger(count) &&
                count > 0
                ? { ...contest, problemCount: count }
                : contest;
            }),
            problemCountsCheckedAt: now,
          };
          await saveContestCache(storage, platform, updated);
        } catch {
          // Optional count enrichment never changes the primary contest result.
          const latest = await loadContestCache(storage, platform);
          if (
            latest &&
            latest.lastSuccessAt === cache.lastSuccessAt &&
            latest.contests
              .map((contest) => `${contest.id}:${contest.fetchedAt}`)
              .sort()
              .join("|") ===
              cache.contests
                .map((contest) => `${contest.id}:${contest.fetchedAt}`)
                .sort()
                .join("|")
          )
            await saveContestCache(storage, platform, {
              ...latest,
              problemCountsCheckedAt: now,
            });
        }
      })();
      enrichInFlight[platform] = operation;
      try {
        await operation;
      } finally {
        delete enrichInFlight[platform];
      }
    }

    await Promise.all(platforms.map((platform) => enrichPlatform(platform)));
    return load();
  }

  async function clear(): Promise<void> {
    if (!storage.remove) throw new Error("当前存储不支持清除赛程缓存。");
    await ensureAttemptsRestored();
    for (const platform of CONTEST_PLATFORMS) delete lastRequestedAt[platform];
    await storage.remove([
      ...CONTEST_PLATFORMS.map((platform) => CONTEST_CACHE_KEYS[platform]),
      CONTEST_REQUEST_ATTEMPTS_KEY,
    ]);
  }

  return { load, refresh, enrichProblemCounts, clear };
}
