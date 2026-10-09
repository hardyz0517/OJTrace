import { immediatePagination } from "../helpers/fetch-input";
import { describe, expect, it, vi } from "vitest";
import type { FetchInput, HttpClient, SourceId } from "../../src/domain";
import type { CollectionProgress } from "../../src/domain/sync-progress";
import { createHttpClient } from "../../src/platform/network/http-client";
import { codeforcesAdapter } from "../../src/adapters/codeforces";
import { luoguAdapter } from "../../src/adapters/luogu";
import { atcoderAdapter } from "../../src/adapters/atcoder";
import { qojAdapter } from "../../src/adapters/qoj";

function response(url: string, data: unknown, status = 200) {
  return {
    url,
    status,
    contentType: "application/json",
    text: JSON.stringify(data),
    headers: new Headers(),
  };
}

function input(
  source: SourceId,
  http: HttpClient,
  overrides: Partial<FetchInput> = {},
): FetchInput {
  return {
    account: {
      source,
      accountId: "account",
      providerAccountKey: "tester",
      enabled: true,
      authMode: source === "codeforces" ? "public-handle" : "browser-session",
    },
    now: 100_000,
    since: 20_000,
    until: 30_000,
    limit: 1000,
    signal: new AbortController().signal,
    requestId: "test",
    http,
    pagination: immediatePagination(),
    ...overrides,
  };
}

const cfRow = (id: number, seconds: number) => ({
  id,
  creationTimeSeconds: seconds,
  problem: { index: "A", contestId: 1 },
  verdict: "OK",
});
const atRow = (id: number, seconds: number) => ({
  id,
  epoch_second: seconds,
  contest_id: "abc1",
  problem_id: "abc1_a",
  language: "C++",
  point: 100,
  result: "AC",
});
const luoguPage = (page: number, times: number[], count = 20) => ({
  data: {
    user: { uid: "tester", name: "tester" },
    records: {
      count,
      perPage: 2,
      result: times.map((seconds, index) => ({
        id: page * 10 + index,
        submitTime: seconds,
        status: 12,
        problem: { pid: "P1001" },
      })),
    },
  },
});

describe("submission collection windows", () => {
  it("CF progress counts its logical page once across a physical HTTP retry", async () => {
    vi.useFakeTimers();
    const updates: Partial<CollectionProgress>[] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "OK",
            result: [cfRow(3, 31), cfRow(2, 30), cfRow(2, 30), cfRow(1, 20)],
          }),
        ),
      );
    try {
      const work = codeforcesAdapter.fetchRecent(
        input("codeforces", createHttpClient(), {
          onProgress: (update) => updates.push(update),
        }),
      );
      await vi.runAllTimersAsync();
      const result = await work;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.records).toHaveLength(2);
      expect(updates).toEqual([
        { phase: "identity", pagesFetched: 0, recordsFetched: 0 },
        { phase: "list", pagesFetched: 1, recordsFetched: 0 },
        { phase: "list", pagesFetched: 1, recordsFetched: 2 },
      ]);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("Luogu progress excludes positioning pages from records and reports only a page estimate", async () => {
    const updates: Partial<CollectionProgress>[] = [];
    let calls = 0;
    const result = await luoguAdapter.fetchRecent(
      input(
        "luogu",
        {
          async request(_source, url) {
            calls += 1;
            return response(
              url,
              luoguPage(calls, calls === 1 ? [40, 35] : [30, 19], 20),
            );
          },
        },
        { onProgress: (update) => updates.push(update) },
      ),
    );
    expect(result.records).toHaveLength(1);
    expect(updates).toContainEqual({
      phase: "list",
      pagesFetched: 1,
      recordsFetched: 0,
      pageEstimate: 10,
    });
    expect(updates.at(-1)).toEqual({
      phase: "list",
      pagesFetched: 2,
      recordsFetched: 1,
      pageEstimate: 10,
    });
    expect(calls).toBe(2);
  });

  it("progress observation failure does not fail collection", async () => {
    await expect(
      codeforcesAdapter.fetchRecent(
        input(
          "codeforces",
          {
            async request(_source, url) {
              return response(url, { status: "OK", result: [] });
            },
          },
          {
            onProgress: () => {
              throw new Error("Disconnected observer");
            },
          },
        ),
      ),
    ).resolves.toMatchObject({ records: [] });
  });

  it("AtCoder reports completed details after settlement and does not count skipped tasks", async () => {
    const updates: Partial<CollectionProgress>[] = [];
    const finish: Array<() => void> = [];
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const work = atcoderAdapter.fetchRecent(
      input(
        "atcoder",
        {
          async request(_source, url) {
            if (url.includes("user/submissions"))
              return response(url, [
                ...Array.from({ length: 8 }, (_, index) =>
                  atRow(index + 1, 25),
                ),
                atRow(20, 31),
                atRow(1, 25),
              ]);
            if (url.includes("problems.json")) return response(url, []);
            await new Promise<void>((resolve) => {
              finish.push(resolve);
              if (finish.length === 4) dispatched();
            });
            return response(url, {}, 429);
          },
        },
        { onProgress: (update) => updates.push(update) },
      ),
    );
    await started;
    expect(updates.at(-1)).toEqual({
      phase: "details",
      pagesFetched: 1,
      recordsFetched: 8,
      detailsTotal: 8,
      detailsCompleted: 0,
    });
    for (const resolve of finish) resolve();
    await work;
    expect(finish).toHaveLength(4);
    expect(updates.at(-1)).toEqual({
      phase: "details",
      pagesFetched: 1,
      recordsFetched: 8,
      detailsTotal: 8,
      detailsCompleted: 4,
    });
  });

  it("invalid Luogu timestamps cannot become records or coverage boundaries", async () => {
    const result = await luoguAdapter.fetchRecent(
      input("luogu", {
        async request(_source, url) {
          return response(url, luoguPage(1, [30.000001, 25], 2));
        },
      }),
    );
    expect(result.records.map((record) => record.submittedAt)).toEqual([
      25_000,
    ]);
    expect(result.coverage.outcome).toEqual({
      status: "partial",
      reasons: ["invalid-record"],
    });
  });

  it("AtCoder metadata deadline preserves base records and reports enrichment", async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    const updates: Partial<CollectionProgress>[] = [];
    const result = await atcoderAdapter.fetchRecent(
      input(
        "atcoder",
        {
          async request(_source, url) {
            urls.push(url);
            if (url.includes("user/submissions"))
              return response(url, [atRow(1, 25)]);
            controller.abort({ kind: "deadline" });
            throw controller.signal.reason;
          },
        },
        {
          signal: controller.signal,
          onProgress: (update) => updates.push(update),
        },
      ),
    );
    expect(urls).toHaveLength(2);
    expect(result.records).toHaveLength(1);
    expect(updates.at(-1)).toEqual({
      phase: "details",
      pagesFetched: 1,
      recordsFetched: 1,
      detailsTotal: 1,
      detailsCompleted: 0,
    });
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "enrichment-incomplete",
      ),
    ).toBe(true);
    expect(result.coverage.outcome).toEqual({
      status: "complete",
      evidence: "exhausted",
    });
  });

  it("Luogu marks an empty page with remaining count as partial", async () => {
    const result = await luoguAdapter.fetchRecent(
      input("luogu", {
        async request(_source, url) {
          return response(url, luoguPage(1, [], 20));
        },
      }),
    );
    expect(result.coverage.outcome).toEqual({
      status: "partial",
      reasons: ["unverified-coverage"],
    });
  });

  it("Luogu stops a repeated page and deduplicates verified records", async () => {
    let calls = 0;
    const result = await luoguAdapter.fetchRecent(
      input("luogu", {
        async request(_source, url) {
          calls += 1;
          return response(url, luoguPage(1, [30, 25]));
        },
      }),
    );
    expect(calls).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(result.coverage.outcome).toEqual({
      status: "partial",
      reasons: ["pagination-repeated"],
    });
  });

  it("Luogu distinguishes deadline partials from owner cancellation", async () => {
    for (const reason of [{ kind: "deadline" }, { kind: "owner-cancelled" }]) {
      const controller = new AbortController();
      let calls = 0;
      const work = luoguAdapter.fetchRecent(
        input(
          "luogu",
          {
            async request(_source, url) {
              calls += 1;
              if (calls === 2) {
                controller.abort(reason);
                throw reason;
              }
              return response(url, luoguPage(1, [30, 25]));
            },
          },
          { signal: controller.signal },
        ),
      );
      if (reason.kind === "deadline") {
        const result = await work;
        expect(result.records).toHaveLength(2);
        expect(result.coverage.outcome).toEqual({
          status: "partial",
          reasons: ["deadline"],
        });
      } else await expect(work).rejects.toBe(reason);
    }
  });

  it("QOJ positions through pages above until and stops below since", async () => {
    let calls = 0;
    const updates: Partial<CollectionProgress>[] = [];
    const times = [
      [40, 35],
      [30, 25],
      [20, 19],
    ];
    const result = await qojAdapter.fetchRecent(
      input(
        "qoj",
        {
          async request(_source, url) {
            const page = calls++;
            const rows = times[page]!.map(
              (seconds, index) =>
                `<tr><td><a href="/submission/${page * 2 + index + 1}">#${page * 2 + index + 1}</a></td><td><a href="/problem/1">A</a></td><td>tester</td><td>AC</td><td>1ms</td><td>1kb</td><td>C++</td><td>1kb</td><td>${seconds}</td></tr>`,
            ).join("");
            const text = `<html><title>Submissions</title><ul class="nav"><span class="uoj-username" data-link="0">tester</span><a href="/logout">Logout</a></ul><table><tbody>${rows}</tbody></table><ul class="pagination"><li><a href="/submissions?submitter=tester&amp;page=${page + 2}">${page + 2}</a></li></ul></html>`;
            return {
              url,
              status: 200,
              contentType: "text/html",
              text,
              headers: new Headers(),
            };
          },
        },
        { onProgress: (update) => updates.push(update) },
      ),
    );
    expect(calls).toBe(3);
    expect(updates.at(-1)).toEqual({
      phase: "list",
      pagesFetched: 3,
      recordsFetched: 3,
    });
    expect(
      updates
        .filter((update) => update.phase === "list")
        .map((update) => update.recordsFetched),
    ).toEqual([0, 0, 0, 2, 2, 3]);
    expect(result.records.map((record) => record.submittedAt)).toEqual([
      30_000, 25_000, 20_000,
    ]);
    expect(result.coverage.outcome).toEqual({
      status: "complete",
      evidence: "window-boundary",
    });
  });

  it("CF uses only the identity endpoint for public authorization", async () => {
    const urls: string[] = [];
    const context = input("codeforces", {
      async request(_source, url) {
        urls.push(url);
        return response(url, { status: "OK", result: [{ handle: "Tester" }] });
      },
    });
    expect(
      (await codeforcesAdapter.authorize(context)).providerAccountKey,
    ).toBe("Tester");
    expect(urls).toEqual([
      "https://codeforces.com/api/user.info?handles=tester",
    ]);
  });

  it("CF preserves both endpoints and excludes outside records before the quota", async () => {
    const context = input(
      "codeforces",
      {
        async request(_source, url) {
          return response(url, {
            status: "OK",
            result: [cfRow(4, 31), cfRow(3, 30), cfRow(2, 20), cfRow(1, 19)],
          });
        },
      },
      { limit: 2 },
    );
    const result = await codeforcesAdapter.fetchRecent(context);
    expect(result.records.map((record) => record.submissionId)).toEqual([
      "3",
      "2",
    ]);
    expect(result.coverage.outcome.status).toBe("complete");
  });

  it("CF does not call an unreachable old window an empty complete result", async () => {
    const context = input("codeforces", {
      async request(_source, url) {
        return response(url, {
          status: "OK",
          result: Array.from({ length: 1000 }, (_, index) =>
            cfRow(index + 1, 40),
          ),
        });
      },
    });
    const result = await codeforcesAdapter.fetchRecent(context);
    expect(result.records).toEqual([]);
    expect(result.coverage.outcome).toEqual({
      status: "partial",
      reasons: ["record-limit"],
    });
  });

  it("Luogu continues positioning above until then stops at the lower boundary", async () => {
    const urls: string[] = [];
    const pages = [
      [40, 35],
      [30, 25],
      [20, 19],
    ];
    const context = input("luogu", {
      async request(_source, url) {
        urls.push(url);
        const page = Number(new URL(url).searchParams.get("page"));
        return response(url, luoguPage(page, pages[page - 1]!));
      },
    });
    const result = await luoguAdapter.fetchRecent(context);
    expect(urls).toHaveLength(3);
    expect(result.records.map((record) => record.submittedAt)).toEqual([
      30_000, 25_000, 20_000,
    ]);
    expect(result.coverage.outcome).toEqual({
      status: "complete",
      evidence: "window-boundary",
    });
    expect(result.coverage.pagesFetched).toBe(3);
  });

  it("Luogu uses count/perPage to avoid an extra empty page", async () => {
    let calls = 0;
    const result = await luoguAdapter.fetchRecent(
      input("luogu", {
        async request(_source, url) {
          calls += 1;
          return response(url, luoguPage(1, [30, 25], 2));
        },
      }),
    );
    expect(calls).toBe(1);
    expect(result.coverage.outcome).toEqual({
      status: "complete",
      evidence: "exhausted",
    });
  });

  it("Luogu disables boundary stopping on unordered timestamps", async () => {
    let calls = 0;
    const result = await luoguAdapter.fetchRecent(
      input("luogu", {
        async request(_source, url) {
          calls += 1;
          return response(
            url,
            luoguPage(calls, calls === 1 ? [19, 30] : [25, 20], 4),
          );
        },
      }),
    );
    expect(calls).toBe(2);
    expect(result.records.map((record) => record.submittedAt)).toEqual([
      30_000, 25_000, 20_000,
    ]);
  });

  it("Luogu retains verified pages after a later 429", async () => {
    let calls = 0;
    const result = await luoguAdapter.fetchRecent(
      input("luogu", {
        async request(_source, url) {
          calls += 1;
          return calls === 1
            ? response(url, luoguPage(1, [30, 25]))
            : response(url, {}, 429);
        },
      }),
    );
    expect(result.records).toHaveLength(2);
    expect(result.coverage.outcome).toEqual({
      status: "partial",
      reasons: ["rate-limited"],
    });
    expect(result.coverage.pagesFetched).toBe(2);
  });

  it("AtCoder requests only selected unique details and skips metadata for an empty selection", async () => {
    const urls: string[] = [];
    const http: HttpClient = {
      async request(_source, url) {
        urls.push(url);
        return response(
          url,
          url.includes("user/submissions")
            ? [
                atRow(4, 31),
                atRow(3, 30),
                atRow(3, 30),
                atRow(2, 20),
                atRow(1, 19),
              ]
            : [],
        );
      },
    };
    const result = await atcoderAdapter.fetchRecent(input("atcoder", http));
    expect(result.records.map((record) => record.submissionId)).toEqual([
      "3",
      "2",
    ]);
    expect(
      urls.filter((url) => url.startsWith("https://atcoder.jp/contests/")),
    ).toHaveLength(2);
    expect(urls.some((url) => /submissions\/(1|4)$/.test(url))).toBe(false);
    urls.length = 0;
    await atcoderAdapter.fetchRecent(
      input("atcoder", http, { since: 50_000, until: 60_000 }),
    );
    expect(urls).toHaveLength(1);
  });

  it("AtCoder does not schedule more details after a 429", async () => {
    let details = 0;
    const result = await atcoderAdapter.fetchRecent(
      input("atcoder", {
        async request(_source, url) {
          if (url.includes("user/submissions"))
            return response(
              url,
              Array.from({ length: 10 }, (_, index) => atRow(index + 1, 25)),
            );
          if (url.includes("problems.json")) return response(url, []);
          details += 1;
          return response(url, {}, 429);
        },
      }),
    );
    expect(details).toBeLessThanOrEqual(4);
    expect(result.records).toHaveLength(10);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "enrichment-incomplete",
      ),
    ).toBe(true);
  });
});
