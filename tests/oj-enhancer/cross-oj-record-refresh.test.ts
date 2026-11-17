import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorageArea } from "../helpers/memory-storage";
import type { CrossOjProblemRef } from "../../src/oj-enhancer/features/cross-oj-submit/model";

async function recordQuery(
  oj: "codeforces" | "atcoder" = "codeforces",
  session = memoryStorageArea(),
) {
  vi.resetModules();
  const { handleCrossOjSubmitMessage } =
    await import("../../src/oj-enhancer/features/cross-oj-submit/background-bridge");
  const problem: CrossOjProblemRef =
    oj === "codeforces"
      ? { oj, contestId: "1", index: "A", source: "luogu-pid" }
      : { oj, contestId: "abc175", taskId: "abc175_f", source: "luogu-pid" };
  const pageUrl = `https://www.luogu.com.cn/record/list?pid=${oj === "codeforces" ? "CF1A" : "AT_abc175_f"}`;
  vi.stubGlobal("browser", {
    runtime: { id: "ojtrace-test" },
    tabs: { get: async () => ({ id: 7, url: pageUrl }) },
    permissions: {
      contains: async ({ origins }: { origins: string[] }) =>
        !origins.includes("https://www.luogu.com.cn/*"),
    },
    storage: {
      local: memoryStorageArea({
        "ojtrace:data": {
          accounts: [
            { source: oj, enabled: true, providerAccountKey: "alice" },
          ],
        },
      }),
      session,
    },
  });
  return () =>
    handleCrossOjSubmitMessage(
      {
        schemaVersion: 1,
        requestId: "refresh-query",
        type: "REFRESH_CROSS_OJ_RECORDS",
        problem,
        pageUrl,
      },
      { id: "ojtrace-test", url: pageUrl, frameId: 0, tab: { id: 7 } },
    );
}

function codeforcesResponse(id: number): Response {
  return new Response(
    JSON.stringify({
      status: "OK",
      result: [
        {
          id,
          creationTimeSeconds: 1_700_000_000 + id,
          verdict: "OK",
          problem: { contestId: 1, index: "A", name: "Theatre Square" },
        },
      ],
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cross-OJ record refresh requests", () => {
  it("fetches new records within 60 seconds and merges concurrent refreshes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T09:00:00Z"));
    const query = await recordQuery();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(codeforcesResponse(11))
      .mockResolvedValueOnce(codeforcesResponse(12));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await query())?.records?.map((record) => record.submissionId),
    ).toEqual(["11"]);
    const second = query();
    const duplicate = query();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(
      (await second)?.records?.map((record) => record.submissionId),
    ).toEqual(["12", "11"]);
    expect((await duplicate)?.records).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["codeforces", "atcoder"] as const)(
    "preserves %s HTTP 429 cooldown across refreshes and worker restarts",
    async (oj) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-17T09:00:00Z"));
      const session = memoryStorageArea();
      const query = await recordQuery(oj, session);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response("", { status: 429, headers: { "Retry-After": "180" } }),
        );
      vi.stubGlobal("fetch", fetchMock);
      expect((await query())?.recordsMessage).toContain("原站限制了请求频率");
      expect((await query())?.recordsMessage).toContain("180 秒");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0);
      const recreatedQuery = await recordQuery(oj, session);
      expect((await recreatedQuery())?.recordsMessage).toContain("180 秒");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
