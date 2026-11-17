import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CrossOjProblemRef } from "../../src/oj-enhancer/features/cross-oj-submit/model";
import { memoryStorageArea } from "../helpers/memory-storage";
import { deferred } from "../helpers/deferred";
import {
  isCrossOjMessage,
  isCrossOjResponse,
} from "../../src/oj-enhancer/features/cross-oj-submit/model";

function publicProblemResponse(problemId: string, fixture: string): Response {
  const html = readFileSync(
    new URL(`../../docs/fixtures/luogu/${fixture}`, import.meta.url),
    "utf8",
  );
  const response = new Response(html);
  Object.defineProperty(response, "url", {
    value: `https://www.luogu.com.cn/problem/${problemId}`,
  });
  return response;
}

async function backgroundQuery(
  problemId: string,
  problem: CrossOjProblemRef,
  session = memoryStorageArea(),
) {
  vi.resetModules();
  const { handleCrossOjSubmitMessage } =
    await import("../../src/oj-enhancer/features/cross-oj-submit/background-bridge");
  const pageUrl = `https://www.luogu.com.cn/record/list?pid=${problemId}`;
  vi.stubGlobal("browser", {
    runtime: { id: "ojtrace-test" },
    tabs: { get: async () => ({ id: 7, url: pageUrl }) },
    permissions: { contains: async () => true },
    storage: {
      local: { get: async () => ({}) },
      session,
    },
  });
  return (
    type:
      | "GET_CROSS_OJ_RECORDS"
      | "REFRESH_CROSS_OJ_RECORDS"
      | "GET_CROSS_OJ_PROBLEM_DIFFICULTY" = "GET_CROSS_OJ_PROBLEM_DIFFICULTY",
  ) =>
    handleCrossOjSubmitMessage(
      {
        schemaVersion: 1,
        requestId: "difficulty-query",
        type,
        problem,
        pageUrl,
      },
      { id: "ojtrace-test", url: pageUrl, frameId: 0, tab: { id: 7 } },
    );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cross-OJ record difficulty metadata", () => {
  it("validates the metadata command and retry timestamp", () => {
    const message = {
      schemaVersion: 1,
      requestId: "guard",
      type: "GET_CROSS_OJ_PROBLEM_DIFFICULTY",
      problem: {
        oj: "codeforces",
        contestId: "1",
        index: "A",
        source: "luogu-pid",
      },
      pageUrl: "https://www.luogu.com.cn/record/list?pid=CF1A",
    };
    expect(isCrossOjMessage(message)).toBe(true);
    expect(
      isCrossOjMessage({
        ...message,
        pageUrl: "https://evil.example/record/list?pid=CF1A",
      }),
    ).toBe(false);
    const reply = {
      schemaVersion: 1,
      requestId: "guard",
      ok: true,
      code: "problem-difficulty-loaded",
      problemDifficultyRetryAt: 1_800_000_000_000,
    };
    expect(isCrossOjResponse(reply, "guard")).toBe(true);
    expect(
      isCrossOjResponse({ ...reply, problemDifficultyRetryAt: NaN }, "guard"),
    ).toBe(false);
    expect(
      isCrossOjResponse({ ...reply, problemDifficultyRetryAt: -1 }, "guard"),
    ).toBe(false);
  });

  it("uses the authorized page's exact AtCoder problem ID", async () => {
    const query = await backgroundQuery("AT_abc175_f", {
      oj: "atcoder",
      contestId: "abc175",
      taskId: "abc175_f",
      source: "luogu-pid",
    });
    const reply = new Response(
      '<script id="lentille-context" type="application/json">' +
        JSON.stringify({
          data: { problem: { pid: "AT_abc175_f", difficulty: 5 } },
        }) +
        "</script>",
    );
    Object.defineProperty(reply, "url", {
      value: "https://www.luogu.com.cn/problem/AT_abc175_f",
    });
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    expect((await query())?.problemDifficulty).toBe(5);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.luogu.com.cn/problem/AT_abc175_f",
      expect.anything(),
    );
  });
  it("returns records while an independent difficulty request is pending", async () => {
    const query = await backgroundQuery("CF1A", {
      oj: "codeforces",
      contestId: "1",
      index: "A",
      source: "luogu-pid",
    });
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const metadata = query();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await query("GET_CROSS_OJ_RECORDS")).toMatchObject({
      ok: true,
      records: [],
    });
    pending.resolve(publicProblemResponse("CF1A", "problem-context-cf1a.html"));
    expect((await metadata)?.problemDifficulty).toBe(1);
  });

  it("restores successful difficulty metadata after a worker restart", async () => {
    const session = memoryStorageArea();
    const problem = {
      oj: "codeforces",
      contestId: "1",
      index: "A",
      source: "luogu-pid",
    } as const;
    const query = await backgroundQuery("CF1A", problem, session);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        publicProblemResponse("CF1A", "problem-context-cf1a.html"),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect((await query())?.problemDifficulty).toBe(1);
    const restarted = await backgroundQuery("CF1A", problem, session);
    expect((await restarted())?.problemDifficulty).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retains a successful value if refreshing expired metadata fails", async () => {
    const query = await backgroundQuery("CF1A", {
      oj: "codeforces",
      contestId: "1",
      index: "A",
      source: "luogu-pid",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        publicProblemResponse("CF1A", "problem-context-cf1a.html"),
      )
      .mockRejectedValueOnce(new TypeError("temporary network failure"));
    vi.stubGlobal("fetch", fetchMock);
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    expect((await query())?.problemDifficulty).toBe(1);
    now += 30 * 60_000 + 1;
    expect((await query())?.problemDifficulty).toBe(1);
    expect((await query())?.problemDifficulty).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["CF1A", "1", "A", "problem-context-cf1a.html", 1],
    ["CF1616D", "1616", "D", "problem-context-cf1616d.html", 5],
  ] as const)(
    "passes %s difficulty through cached and fresh record responses",
    async (pid, contestId, index, fixture, difficulty) => {
      const query = await backgroundQuery(pid, {
        oj: "codeforces",
        contestId,
        index,
        source: "luogu-pid",
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(publicProblemResponse(pid, fixture));
      vi.stubGlobal("fetch", fetchMock);
      expect((await query())?.problemDifficulty).toBe(difficulty);
      expect((await query("REFRESH_CROSS_OJ_RECORDS"))?.problemDifficulty).toBe(
        difficulty,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        `https://www.luogu.com.cn/problem/${pid}`,
        expect.objectContaining({ credentials: "omit" }),
      );
    },
  );

  it("respects an origin cooldown and Retry-After when metadata is rate limited", async () => {
    const query = await backgroundQuery("CF1A", {
      oj: "codeforces",
      contestId: "1",
      index: "A",
      source: "luogu-pid",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "180" } }),
      )
      .mockResolvedValueOnce(
        publicProblemResponse("CF1A", "problem-context-cf1a.html"),
      );
    vi.stubGlobal("fetch", fetchMock);
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    expect((await query())?.problemDifficulty).toBeUndefined();
    now += 60_001;
    expect((await query())?.problemDifficulty).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 120_000;
    expect((await query())?.problemDifficulty).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers after a failed fetch instead of caching missing difficulty for 30 minutes", async () => {
    vi.resetModules();
    const { handleCrossOjSubmitMessage } =
      await import("../../src/oj-enhancer/features/cross-oj-submit/background-bridge");
    const pageUrl = "https://www.luogu.com.cn/record/list?pid=CF1616D";
    vi.stubGlobal("browser", {
      runtime: { id: "ojtrace-test" },
      tabs: { get: async () => ({ id: 7, url: pageUrl }) },
      permissions: { contains: async () => true },
      storage: {
        local: { get: async () => ({}) },
        session: { get: async () => ({}) },
      },
    });
    const html = readFileSync(
      new URL(
        "../../docs/fixtures/luogu/problem-context-cf1616d.html",
        import.meta.url,
      ),
      "utf8",
    );
    const okResponse = new Response(html);
    Object.defineProperty(okResponse, "url", {
      value: "https://www.luogu.com.cn/problem/CF1616D",
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("temporary network failure"))
      .mockResolvedValueOnce(okResponse);
    vi.stubGlobal("fetch", fetchMock);
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const query = () =>
      handleCrossOjSubmitMessage(
        {
          schemaVersion: 1,
          requestId: "difficulty-query",
          type: "GET_CROSS_OJ_PROBLEM_DIFFICULTY",
          problem: {
            oj: "codeforces",
            contestId: "1616",
            index: "D",
            source: "luogu-pid",
          },
          pageUrl,
        },
        { id: "ojtrace-test", url: pageUrl, frameId: 0, tab: { id: 7 } },
      );

    expect(await query()).toMatchObject({ ok: true });
    expect((await query())?.problemDifficulty).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 60_001;
    expect((await query())?.problemDifficulty).toBe(5);
    expect((await query())?.problemDifficulty).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
