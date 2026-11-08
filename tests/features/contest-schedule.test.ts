import { describe, expect, it } from "vitest";
import {
  buildContestSchedule,
  buildContestSections,
  groupContestSectionByDate,
} from "../../src/features/contest-schedule/core/contest-filter";
import {
  endTimeOf,
  formatContestDateTime,
} from "../../src/features/contest-schedule/core/contest-time";
import {
  FINISHED_WINDOW_MS,
  UPCOMING_WINDOW_MS,
  contestPhaseAt,
  isInDefaultSchedule,
} from "../../src/features/contest-schedule/core/contest-status";
import { createContestManager } from "../../src/features/contest-schedule/core/contest-manager";
import type {
  ContestCache,
  ContestPlatform,
  ContestRecord,
  ContestProviderMap,
} from "../../src/features/contest-schedule/core/types";
import { CONTEST_DATA_VERSION } from "../../src/features/contest-schedule/core/types";
import {
  CONTEST_CACHE_KEYS,
  loadContestCache,
  sanitizeContestCache,
  type ContestCacheStorage,
} from "../../src/features/contest-schedule/storage/contest-cache";
import { parseCodeforcesContests } from "../../src/features/contest-schedule/providers/codeforces/parser";
import { parseAtcoderContestPage } from "../../src/features/contest-schedule/providers/atcoder/parser";
import { parseLuoguContestPage } from "../../src/features/contest-schedule/providers/luogu/parser";
import { fetchLuoguContests } from "../../src/features/contest-schedule/providers/luogu/fetcher";
import type { HttpRequestOptions } from "../../src/domain/adapter";
import { parseCodeforcesProblemCounts } from "../../src/features/contest-schedule/providers/codeforces/problem-counts";
import { parseAtcoderProblemCounts } from "../../src/features/contest-schedule/providers/atcoder/problem-counts";

const now = Date.UTC(2026, 10, 4, 0, 0, 0);

function record(
  id: string,
  startTime: number,
  durationSeconds?: number,
  platform: ContestPlatform = "codeforces",
): ContestRecord {
  return {
    id,
    platform,
    title: `Contest ${id}`,
    url:
      platform === "codeforces"
        ? `https://codeforces.com/contest/${id}`
        : platform === "atcoder"
          ? `https://atcoder.jp/contests/${id}`
          : `https://www.luogu.com.cn/contest/${id}`,
    startTime,
    ...(durationSeconds === undefined
      ? {}
      : { durationSeconds, endTime: startTime + durationSeconds * 1_000 }),
    fetchedAt: now,
  };
}

function luoguHtml(
  items: Array<Record<string, unknown>>,
  count = items.length,
): string {
  return `<script id="lentille-context" type="application/json">${JSON.stringify(
    {
      data: { contests: { perPage: 20, count, result: items } },
    },
  )}</script>`;
}

function luoguItem(
  id: number,
  startTime: number,
  endTime: number,
  problemCount?: number,
  rated?: number,
) {
  return {
    id,
    name: `Luogu ${id}`,
    startTime,
    endTime,
    ...(problemCount === undefined ? {} : { problemCount }),
    ...(rated === undefined ? {} : { rated }),
  };
}

describe("contest schedule time windows", () => {
  it("includes the exact upcoming boundary and excludes contests beyond it", () => {
    const inside = record("1", now + UPCOMING_WINDOW_MS);
    const outside = record("2", now + UPCOMING_WINDOW_MS + 1);
    expect(isInDefaultSchedule(inside, now)).toBe(true);
    expect(isInDefaultSchedule(outside, now)).toBe(false);
    expect(contestPhaseAt(inside, now)).toBe("upcoming");
  });

  it("uses end time for recent history and retains every running contest", () => {
    const endedInside = record(
      "inside",
      now - 9 * 24 * 60 * 60 * 1_000,
      2 * 24 * 60 * 60,
    );
    const endedOutside = record(
      "outside",
      now - 9 * 24 * 60 * 60 * 1_000,
      1 * 24 * 60 * 60,
    );
    const longRunning = record(
      "running",
      now - 12 * 24 * 60 * 60 * 1_000,
      20 * 24 * 60 * 60,
    );

    expect(endedInside.endTime).toBe(now - 7 * 24 * 60 * 60 * 1_000);
    expect(isInDefaultSchedule(endedInside, now)).toBe(true);
    expect(isInDefaultSchedule(endedOutside, now)).toBe(false);
    expect(isInDefaultSchedule(longRunning, now)).toBe(true);
    expect(contestPhaseAt(longRunning, now)).toBe("running");
    expect(FINISHED_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it("marks incomplete upcoming timing and deduplicates only within a platform", () => {
    const incomplete = record("same", now + 1_000);
    const duplicate = { ...record("same", now + 2_000), fetchedAt: now + 1 };
    const otherPlatform = record("same", now + 3_000, 60, "atcoder");
    const result = buildContestSchedule(
      [incomplete, duplicate, otherPlatform],
      now,
    );
    expect(result).toHaveLength(2);
    expect(
      result.find((item) => item.platform === "codeforces")?.timingComplete,
    ).toBe(false);
    expect(result.find((item) => item.platform === "atcoder")).toBeDefined();
  });

  it("builds running, upcoming, and recently ended sections with section-specific order", () => {
    const contests = [
      record("long-running", now - 10 * 86_400_000, 20 * 86_400, "codeforces"),
      record("running-soon-end", now - 3_600_000, 7_200, "atcoder"),
      record("upcoming-later", now + 4 * 86_400_000, 3_600, "luogu"),
      record("upcoming-first", now + 2 * 86_400_000, 3_600, "codeforces"),
      record("ended-later", now - 2 * 86_400_000, 3_600, "atcoder"),
      record("ended-first", now - 86_400_000, 3_600, "codeforces"),
      record("too-old", now - 9 * 86_400_000, 3_600, "luogu"),
      record("outside-upcoming", now + 31 * 86_400_000, 3_600, "luogu"),
    ];
    const sections = buildContestSections(contests, now);
    expect(sections.map((section) => section.key)).toEqual([
      "running",
      "upcoming",
      "finished",
    ]);
    expect(sections[0]?.contests.map(({ id }) => id)).toEqual([
      "running-soon-end",
      "long-running",
    ]);
    expect(sections[1]?.contests.map(({ id }) => id)).toEqual([
      "upcoming-first",
      "upcoming-later",
    ]);
    expect(sections[2]?.contests.map(({ id }) => id)).toEqual([
      "ended-first",
      "ended-later",
    ]);
    expect(
      groupContestSectionByDate(sections[2]!.contests, "finished")[0]!
        .contests[0]!.id,
    ).toBe("ended-first");
  });

  it("prefers duration-derived end time and formats complete local timestamps", () => {
    const contest = {
      ...record("duration-first", now, 90),
      endTime: now + 999_999,
    };
    expect(endTimeOf(contest)).toBe(now + 90_000);
    expect(formatContestDateTime(now)).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
  });

  it("lets the incomplete-timing filter include future contests without an end", () => {
    const incomplete = record("unknown-end", now + 60_000, undefined);
    const schedule = buildContestSections([incomplete], now, {
      platform: "all",
      phase: "unknown",
    });
    expect(schedule).toHaveLength(1);
    expect(schedule[0]?.key).toBe("upcoming");
    expect(schedule[0]?.contests[0]?.timingComplete).toBe(false);
  });

  it("does not trust a cached source phase when timing is missing", () => {
    const incomplete = {
      ...record("stale-source-phase", now - 60_000),
      sourcePhase: "CODING",
    };
    expect(contestPhaseAt(incomplete, now)).toBe("unknown");
  });
});

describe("contest source parsers", () => {
  it("parses Codeforces API fields and rejects failed API envelopes", () => {
    const contests = parseCodeforcesContests(
      {
        status: "OK",
        result: [
          {
            id: 2300,
            name: "Round 2300",
            phase: "BEFORE",
            startTimeSeconds: now / 1_000,
            durationSeconds: 7_200,
            relativeTimeSeconds: -10,
          },
          { id: "bad", name: "Bad", startTimeSeconds: 1 },
        ],
      },
      now,
    );
    expect(contests).toHaveLength(1);
    expect(contests[0]).toMatchObject({
      id: "2300",
      startTime: now,
      endTime: now + 7_200_000,
      sourcePhase: "BEFORE",
      url: "https://codeforces.com/contest/2300",
    });
    expect(() =>
      parseCodeforcesContests({ status: "FAILED", comment: "rate limit" }, now),
    ).toThrow();
  });

  it("parses AtCoder local offsets, durations over 24 hours, and rated ranges", () => {
    const html = `
      <div id="contest-table-upcoming"><table><tbody>
        <tr>
          <td><time class="fixtime fixtime-full">2026-11-07 21:00:00+0900</time></td>
          <td><a href="/contests/abc483">AtCoder Beginner &amp; Contest 483</a></td>
          <td>01:40</td><td> - 1999</td>
        </tr>
        <tr>
          <td><time>2026-11-08 08:00:00+0900</time></td>
          <td><a href="/contests/ahc074">Heuristic</a></td>
          <td>240:00</td><td>All</td>
        </tr>
      </tbody></table></div>
      <div id="contest-table-action"><table><tbody>
        <tr>
          <td><time>2026-11-04 08:00:00+0900</time></td>
          <td><a href="/contests/ongoing">Ongoing Contest</a></td>
          <td>02:00</td><td>-</td>
        </tr>
      </tbody></table></div>
      <div id="contest-table-recent"><table><tbody></tbody></table></div>
      <div id="contest-table-permanent"><a href="/contests/practice">Ignored</a></div>`;
    const contests = parseAtcoderContestPage(html, now);
    expect(contests).toHaveLength(3);
    expect(contests.find((contest) => contest.id === "abc483")).toMatchObject({
      id: "abc483",
      title: "AtCoder Beginner & Contest 483",
      startTime: Date.parse("2026-11-07T12:00:00.000Z"),
      durationSeconds: 6_000,
      ratedRange: "- 1999",
    });
    expect(
      contests.find((contest) => contest.id === "ahc074")?.durationSeconds,
    ).toBe(864_000);
    expect(contests.find((contest) => contest.id === "ongoing")?.title).toBe(
      "Ongoing Contest",
    );
  });

  it("counts Codeforces problems by contest and deduplicates problem indices", () => {
    expect(
      parseCodeforcesProblemCounts(
        {
          status: "OK",
          result: {
            problems: [
              { contestId: 100, index: "A" },
              { contestId: 100, index: "B" },
              { contestId: 100, index: "A" },
              { contestId: 101, index: "A" },
              { contestId: 100, index: "C" },
            ],
          },
        },
        new Set(["100"]),
      ),
    ).toEqual(new Map([["100", 3]]));
  });

  it("counts AtCoder mapped problems by contest without counting duplicate IDs", () => {
    expect(
      parseAtcoderProblemCounts(
        [
          { contest_id: "abc001", problem_id: "abc001_a", problem_index: "A" },
          { contest_id: "abc001", problem_id: "abc001_b", problem_index: "B" },
          { contest_id: "abc001", problem_id: "abc001_a", problem_index: "A" },
          { contest_id: "abc002", problem_id: "abc002_a", problem_index: "A" },
          { contest_id: "abc002", problem_id: "", problem_index: "B" },
        ],
        new Set(["abc001"]),
      ),
    ).toEqual(new Map([["abc001", 2]]));
  });

  it("parses Luogu embedded contest JSON and paginates without inventing rows", async () => {
    const first = parseLuoguContestPage(
      luoguHtml(
        [
          luoguItem(101, now / 1_000, now / 1_000 + 3_600, 8, 3),
          { id: 102, name: "Missing time", startTime: "bad" },
        ],
        40,
      ),
      now,
    );
    expect(first).toMatchObject({ perPage: 20, total: 40 });
    expect(first.contests).toHaveLength(1);
    expect(first.contests[0]).toMatchObject({
      id: "101",
      durationSeconds: 3_600,
      problemCount: 8,
      evaluation: { rating: true, estimate: true },
      url: "https://www.luogu.com.cn/contest/101",
    });

    const calls: string[] = [];
    const pages = [
      Array.from({ length: 20 }, (_, index) =>
        luoguItem(
          201 + index,
          now / 1_000 + 20_000 + index,
          now / 1_000 + 21_000 + index,
        ),
      ),
      Array.from({ length: 20 }, (_, index) =>
        luoguItem(
          221 + index,
          now / 1_000 + 22_000 + index,
          now / 1_000 + 23_000 + index,
        ),
      ),
    ];
    const requestInits: RequestInit[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      requestInits.push(init ?? {});
      const page = calls.length - 1;
      return new Response(luoguHtml(pages[page] ?? [], 40), { status: 200 });
    };
    const paged = await fetchLuoguContests({ fetchImpl, now, maxPages: 2 });
    expect(calls).toEqual([
      "https://www.luogu.com.cn/contest/list",
      "https://www.luogu.com.cn/contest/list?page=2",
    ]);
    expect(paged).toHaveLength(40);
    expect(requestInits).toHaveLength(2);
    for (const init of requestInits) {
      expect(init).toMatchObject({
        credentials: "include",
        redirect: "error",
        headers: {
          Accept: "application/json,text/html,application/xhtml+xml;q=0.9",
        },
      });
    }
  });

  it("ignores missing, zero, and invalid Luogu problem counts", () => {
    const parsed = parseLuoguContestPage(
      luoguHtml([
        luoguItem(601, now / 1_000, now / 1_000 + 3_600, 5),
        {
          ...luoguItem(602, now / 1_000, now / 1_000 + 3_600),
          problemCount: 0,
        },
        {
          ...luoguItem(603, now / 1_000, now / 1_000 + 3_600),
          problemCount: "4",
        },
      ]),
      now,
    );

    expect(parsed.contests.map((contest) => contest.problemCount)).toEqual([
      5,
      undefined,
      undefined,
    ]);
  });

  it("decodes Luogu rating and estimate flags from the rated bitmask", () => {
    const parsed = parseLuoguContestPage(
      luoguHtml([
        luoguItem(611, now / 1_000, now / 1_000 + 3_600, 4, 1),
        luoguItem(612, now / 1_000, now / 1_000 + 3_600, 4, 3),
        luoguItem(613, now / 1_000, now / 1_000 + 3_600, 4, 0),
      ]),
      now,
    );

    expect(parsed.contests.map((contest) => contest.evaluation)).toEqual([
      { rating: true, estimate: false },
      { rating: true, estimate: true },
      { rating: false, estimate: false },
    ]);
  });

  it("identifies the failed Luogu page and preserves the fetch diagnostic", async () => {
    await expect(
      fetchLuoguContests({
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
        now,
      }),
    ).rejects.toThrow("洛谷第 1 页：网络请求失败（Failed to fetch）");
  });

  it("uses the shared Luogu HTTP transport with the same session request as submissions", async () => {
    const requests: Array<{
      source: string;
      url: string;
      options: HttpRequestOptions;
    }> = [];
    const html = luoguHtml(
      [luoguItem(501, now / 1_000 + 3_600, now / 1_000 + 7_200)],
      1,
    );
    const contests = await fetchLuoguContests({
      now,
      fetchImpl: async () => {
        throw new Error(
          "Native fetch must not be used by the background provider",
        );
      },
      http: {
        async request(source, url, options) {
          requests.push({ source, url, options: options ?? {} });
          return {
            status: 200,
            url,
            contentType: "text/html; charset=UTF-8",
            text: html,
            headers: new Headers(),
          };
        },
      },
    });

    expect(contests).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      source: "luogu",
      url: "https://www.luogu.com.cn/contest/list",
      options: {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json,text/html,application/xhtml+xml;q=0.9",
        },
      },
    });
  });
});

describe("contest cache and provider manager", () => {
  it("keeps platform caches isolated and does not overwrite a failed provider", async () => {
    let values: Record<string, unknown> = {};
    const storage: ContestCacheStorage = {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: values[keys] };
        return values;
      },
      async set(items) {
        values = { ...values, ...items };
      },
    };
    const old = record("9999", now + 30_000);
    const manager = createContestManager(storage, {
      luogu: async () => [record("luogu", now + 10_000, 60, "luogu")],
      codeforces: async () => {
        throw new Error("temporary failure");
      },
      atcoder: async () => [record("atcoder", now + 20_000, 60, "atcoder")],
    } satisfies ContestProviderMap);
    values[CONTEST_CACHE_KEYS.codeforces] = {
      schemaVersion: 1,
      platform: "codeforces",
      contests: [{ ...old, fetchedAt: now }],
      lastSuccessAt: now,
    };

    const refreshed = await manager.refresh(
      ["luogu", "codeforces", "atcoder"],
      now + 1,
    );
    expect(refreshed.results.map((result) => result.status)).toEqual([
      "success",
      "failed",
      "success",
    ]);
    expect(refreshed.caches.codeforces?.contests[0]?.id).toBe("9999");
    expect(refreshed.caches.luogu?.contests[0]?.platform).toBe("luogu");
    expect(refreshed.caches.luogu?.contestDataVersion).toBe(
      CONTEST_DATA_VERSION,
    );
    expect(refreshed.caches.atcoder?.contests[0]?.platform).toBe("atcoder");
    expect(values[CONTEST_CACHE_KEYS.luogu]).toBeDefined();
    expect(values[CONTEST_CACHE_KEYS.atcoder]).toBeDefined();
  });

  it("coalesces and cools repeated contest refreshes", async () => {
    let values: Record<string, unknown> = {};
    let calls = 0;
    const storage: ContestCacheStorage = {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: values[keys] };
        return values;
      },
      async set(items) {
        values = { ...values, ...items };
      },
    };
    const manager = createContestManager(storage, {
      luogu: async () => {
        calls += 1;
        return [];
      },
      codeforces: async () => [],
      atcoder: async () => [],
    });

    await manager.refresh(["luogu"], now);
    const cooled = await manager.refresh(["luogu"], now + 1);

    expect(calls).toBe(1);
    expect(
      cooled.results.find((result) => result.platform === "luogu"),
    ).toMatchObject({
      status: "failed",
      message: "请求过于频繁，请稍后再刷新。",
    });

    await manager.refresh(["luogu"], now + 30_001);
    expect(calls).toBe(2);
  });

  it("keeps the refresh cooldown across manager restarts", async () => {
    let values: Record<string, unknown> = {};
    let calls = 0;
    const storage: ContestCacheStorage = {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: values[keys] };
        return values;
      },
      async set(items) {
        values = { ...values, ...items };
      },
    };
    const providers: ContestProviderMap = {
      luogu: async () => {
        calls += 1;
        throw new Error("temporary failure");
      },
      codeforces: async () => [],
      atcoder: async () => [],
    };

    await createContestManager(storage, providers).refresh(["luogu"], now);
    const restarted = await createContestManager(storage, providers).refresh(
      ["luogu"],
      now + 1,
    );

    expect(calls).toBe(1);
    expect(
      restarted.results.find((result) => result.platform === "luogu"),
    ).toMatchObject({
      status: "failed",
      message: "请求过于频繁，请稍后再刷新。",
    });
  });

  it("coalesces concurrent optional problem-count downloads", async () => {
    let values: Record<string, unknown> = {
      [CONTEST_CACHE_KEYS.codeforces]: {
        schemaVersion: 1,
        platform: "codeforces",
        contests: [record("100", now + 10_000, 3_600)],
        lastSuccessAt: now,
        contestDataVersion: CONTEST_DATA_VERSION,
      },
    };
    let calls = 0;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let release!: (counts: ReadonlyMap<string, number>) => void;
    const provider = () => {
      calls += 1;
      signalStarted();
      return new Promise<ReadonlyMap<string, number>>((resolve) => {
        release = resolve;
      });
    };
    const storage: ContestCacheStorage = {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: values[keys] };
        return values;
      },
      async set(items) {
        values = { ...values, ...items };
      },
    };
    const manager = createContestManager(
      storage,
      {
        luogu: async () => [],
        codeforces: async () => [],
        atcoder: async () => [],
      },
      { codeforces: provider },
    );

    const first = manager.enrichProblemCounts(["codeforces"], now + 1, true);
    await started;
    const second = manager.enrichProblemCounts(["codeforces"], now + 2, true);
    release(new Map([["100", 7]]));
    await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(
      (values[CONTEST_CACHE_KEYS.codeforces] as ContestCache).contests[0]
        ?.problemCount,
    ).toBe(7);
  });

  it("rejects cache records with unsafe navigation URLs", () => {
    const cache = {
      schemaVersion: 1,
      platform: "codeforces",
      lastSuccessAt: now,
      contests: [{ ...record("1", now + 5_000), url: "javascript:alert(1)" }],
    };
    const sanitized = sanitizeContestCache(cache, "codeforces");
    expect(sanitized?.contests).toEqual([]);
    expect(loadContestCache).toBeTypeOf("function");
  });

  it("refreshes cached optional problem counts without touching the main provider results", async () => {
    let values: Record<string, unknown> = {};
    const storage: ContestCacheStorage = {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: values[keys] };
        return values;
      },
      async set(items) {
        values = { ...values, ...items };
      },
    };
    const contest = {
      ...record("100", now + 60_000),
      problemCount: 9,
    };
    values[CONTEST_CACHE_KEYS.codeforces] = {
      schemaVersion: 1,
      platform: "codeforces",
      contests: [contest],
      lastSuccessAt: now,
    };
    const manager = createContestManager(
      storage,
      {
        luogu: async () => [],
        codeforces: async () => [],
        atcoder: async () => [],
      },
      {
        codeforces: async (ids) => {
          expect(ids).toEqual(["100"]);
          return new Map([["100", 7]]);
        },
      },
    );

    const result = await manager.enrichProblemCounts(
      ["codeforces"],
      now + 1,
      true,
    );
    expect(result.codeforces?.contests[0]).toMatchObject({ problemCount: 7 });
    expect(result.codeforces?.lastSuccessAt).toBe(now);
  });

  it("accepts optional problem counts only when they are positive integers", () => {
    const cached = {
      schemaVersion: 1,
      platform: "luogu",
      lastSuccessAt: now,
      contests: [
        {
          ...record("1", now + 5_000, undefined, "luogu"),
          problemCount: 0,
        },
        {
          ...record("2", now + 5_000, undefined, "luogu"),
          problemCount: 4,
        },
        {
          ...record("3", now + 5_000, undefined, "luogu"),
          evaluation: { rating: true, estimate: true },
        },
      ],
      contestDataVersion: CONTEST_DATA_VERSION,
    };
    expect(
      sanitizeContestCache(cached, "luogu")?.contests.map(
        (contest) => contest.problemCount,
      ),
    ).toEqual([undefined, 4, undefined]);
    expect(
      sanitizeContestCache(cached, "luogu")?.contests[2]?.evaluation,
    ).toEqual({ rating: true, estimate: true });
    expect(sanitizeContestCache(cached, "luogu")?.contestDataVersion).toBe(
      CONTEST_DATA_VERSION,
    );
  });
});
