import { describe, expect, it, vi } from "vitest";
import { atcoderAdapter } from "../../src/adapters/atcoder";
import { collectAtCoderSubmissions } from "../../src/adapters/atcoder/submissions";
import { createPaginationRuntime } from "../../src/platform/network/pagination-throttle";
import { HttpClientError } from "../../src/platform/network/http-client";
import type {
  CollectionProgress,
  FetchInput,
  HttpClient,
} from "../../src/domain";

const raw = (id: number, second: number) => ({
  id,
  epoch_second: second,
  contest_id: "abc1",
  problem_id: "abc1_a",
  language: "C++",
  point: 100,
  result: "AC",
});
function response(url: string, data: unknown, status = 200) {
  return {
    url,
    status,
    text: JSON.stringify(data),
    contentType: "application/json",
    headers: new Headers(),
  };
}
function input(
  http: HttpClient,
  overrides: Partial<FetchInput> = {},
): FetchInput {
  return {
    account: {
      accountId: "a",
      source: "atcoder",
      providerAccountKey: "Hardy_Zheng",
      enabled: true,
      authMode: "browser-session",
    },
    now: 900_000,
    since: 20_000,
    until: 700_000,
    limit: 1000,
    signal: new AbortController().signal,
    requestId: "r",
    http,
    pagination: { runPage: ({ request }) => request() },
    ...overrides,
  };
}

describe("AtCoder range completeness", () => {
  it("marks an uncapped valid response complete and keeps optional detail failures separate", async () => {
    let calls = 0;
    const result = await atcoderAdapter.fetchRecent(
      input({
        async request(_source, url) {
          if (url.includes("user/submissions")) {
            calls += 1;
            return response(url, [raw(1, 25), raw(2, 30)]);
          }
          return response(url, {}, 403);
        },
      }),
    );
    expect(result.records).toHaveLength(2);
    expect(result.coverage.outcome).toEqual({
      status: "complete",
      evidence: "exhausted",
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "enrichment-incomplete" }),
    );
    expect(calls).toBe(1);
  });

  it("recognizes an empty window without extra verification or detail requests", async () => {
    const request = vi.fn(async (_source, url: string) => response(url, []));
    const result = await atcoderAdapter.fetchRecent(input({ request }));
    expect(result.coverage.outcome).toEqual({
      status: "complete",
      evidence: "exhausted",
    });
    expect(result.records).toEqual([]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("continues full batches with an inclusive time cursor, deduplicates ties, and applies jittered page delays", async () => {
    const cursors: string[] = [];
    const sleeps: number[] = [];
    const updates: Partial<CollectionProgress>[] = [];
    const result = await collectAtCoderSubmissions(
      input(
        {
          async request(_source, url, options) {
            const cursor = new URL(url).searchParams.get("from_second")!;
            cursors.push(cursor);
            expect(options?.credentials).toBe("omit");
            return response(
              url,
              cursor === "20"
                ? [
                    ...Array.from({ length: 498 }, (_, index) =>
                      raw(index + 1, index + 20),
                    ),
                    raw(499, 519),
                    raw(500, 519),
                  ]
                : [raw(499, 519), raw(500, 519), raw(501, 519), raw(502, 520)],
            );
          },
        },
        {
          onProgress: (update) => updates.push(update),
          pagination: createPaginationRuntime({
            random: () => 0.5,
            sleep: async (ms) => {
              sleeps.push(ms);
            },
          }),
        },
      ),
      "Hardy_Zheng",
    );
    expect(cursors).toEqual(["20", "519"]);
    expect(sleeps).toEqual([1500]);
    expect(result.rows).toHaveLength(502);
    expect(result.pagesFetched).toBe(2);
    expect(result.outcome).toEqual({
      status: "complete",
      evidence: "exhausted",
    });
    expect(updates.at(-1)).toEqual({
      phase: "list",
      pagesFetched: 2,
      recordsFetched: 502,
    });
  });

  it("stops after crossing until even on a full batch and never fetches out-of-range details", async () => {
    const lists: string[] = [];
    const details: string[] = [];
    const result = await atcoderAdapter.fetchRecent(
      input(
        {
          async request(_source, url) {
            if (url.includes("user/submissions")) {
              lists.push(url);
              return response(
                url,
                Array.from({ length: 500 }, (_, index) =>
                  raw(index + 1, index + 20),
                ),
              );
            }
            if (url.includes("atcoder.jp")) details.push(url);
            return response(url, []);
          },
        },
        { since: 20_001, until: 22_000 },
      ),
    );
    expect(result.coverage.outcome).toEqual({
      status: "complete",
      evidence: "window-boundary",
    });
    expect(lists).toHaveLength(1);
    expect(result.records.map((record) => record.submissionId)).toEqual([
      "3",
      "2",
    ]);
    expect(details).toHaveLength(2);
    expect(details.some((url) => /submissions\/(1|4)$/.test(url))).toBe(false);
  });

  it("verifies the final second instead of skipping records sharing an until boundary", async () => {
    const cursors: string[] = [];
    const result = await collectAtCoderSubmissions(
      input(
        {
          async request(_source, url) {
            const cursor = new URL(url).searchParams.get("from_second")!;
            cursors.push(cursor);
            return response(
              url,
              cursor === "20"
                ? [
                    ...Array.from({ length: 499 }, (_, index) =>
                      raw(index + 1, index + 20),
                    ),
                    raw(500, 519),
                  ]
                : [raw(500, 519), raw(501, 519), raw(502, 520)],
            );
          },
        },
        { until: 519_000 },
      ),
      "Hardy_Zheng",
    );
    expect(cursors).toEqual(["20", "519"]);
    expect(result.rows).toHaveLength(501);
    expect(result.rows.some((row) => row.id === "501")).toBe(true);
    expect(result.outcome).toEqual({
      status: "complete",
      evidence: "window-boundary",
    });
  });

  it("does not silently skip a full second with 500 submissions or loop forever", async () => {
    const request = vi.fn(async (_source, url: string) =>
      response(
        url,
        Array.from({ length: 500 }, (_, index) => raw(index + 1, 20)),
      ),
    );
    const result = await collectAtCoderSubmissions(
      input({ request }),
      "Hardy_Zheng",
    );
    expect(result.outcome).toEqual({
      status: "partial",
      reasons: ["unverified-coverage"],
    });
    expect(request).toHaveBeenCalledOnce();
    expect(result.rows).toHaveLength(500);
  });

  it("retains earlier pages when a subsequent logical page is rate limited", async () => {
    let calls = 0;
    const result = await collectAtCoderSubmissions(
      input({
        async request(_source, url) {
          calls += 1;
          return calls === 1
            ? response(
                url,
                Array.from({ length: 500 }, (_, index) =>
                  raw(index + 1, index + 20),
                ),
              )
            : response(url, {}, 429);
        },
      }),
      "Hardy_Zheng",
    );
    expect(result.rows).toHaveLength(500);
    expect(result.pagesFetched).toBe(2);
    expect(result.outcome).toEqual({
      status: "partial",
      reasons: ["rate-limited"],
    });
  });

  it("keeps empty first-page failures as account errors", async () => {
    await expect(
      collectAtCoderSubmissions(
        input({
          async request(_source, url) {
            return response(url, {}, 429);
          },
        }),
        "Hardy_Zheng",
      ),
    ).rejects.toMatchObject({ error: { kind: "rate_limited" } });
  });

  it("retains valid records when the origin cooldown rejects a queued page before dispatch", async () => {
    let scheduled = 0;
    const request = vi.fn(async (_source, url: string) =>
      response(
        url,
        Array.from({ length: 500 }, (_, index) => raw(index + 1, index + 20)),
      ),
    );
    const result = await collectAtCoderSubmissions(
      input(
        { request },
        {
          pagination: {
            async runPage({ request }) {
              if (++scheduled === 2)
                throw new HttpClientError("rate_limited", "cooldown", 30_000);
              return request();
            },
          },
        },
      ),
      "Hardy_Zheng",
    );
    expect(result.rows).toHaveLength(500);
    expect(result.pagesFetched).toBe(1);
    expect(request).toHaveBeenCalledOnce();
    expect(result.outcome).toEqual({
      status: "partial",
      reasons: ["rate-limited"],
    });
  });

  it("reports a deadline after valid pages as partial but does not save owner cancellation", async () => {
    for (const kind of ["deadline", "cancelled"]) {
      const controller = new AbortController();
      let calls = 0;
      const work = collectAtCoderSubmissions(
        input(
          {
            async request(_source, url) {
              if (++calls === 1)
                return response(
                  url,
                  Array.from({ length: 500 }, (_, index) =>
                    raw(index + 1, index + 20),
                  ),
                );
              controller.abort({ kind });
              throw controller.signal.reason;
            },
          },
          { signal: controller.signal },
        ),
        "Hardy_Zheng",
      );
      if (kind === "deadline")
        expect((await work).outcome).toEqual({
          status: "partial",
          reasons: ["deadline"],
        });
      else await expect(work).rejects.toEqual({ kind });
    }
  });

  it("keeps limit, malformed time, unordered and contract violations partial", async () => {
    for (const [rows, overrides, reason] of [
      [[raw(1, 25), raw(2, 26)], { limit: 1 }, "record-limit"],
      [[raw(1, 25.0001)], {}, "invalid-record"],
      [[raw(1, 26), raw(2, 25)], {}, "unverified-coverage"],
      [
        Array.from({ length: 501 }, (_, index) => raw(index + 1, index + 20)),
        {},
        "unverified-coverage",
      ],
    ] as const) {
      const result = await collectAtCoderSubmissions(
        input(
          {
            async request(_source, url) {
              return response(url, rows);
            },
          },
          overrides,
        ),
        "Hardy_Zheng",
      );
      expect(result.outcome).toEqual({ status: "partial", reasons: [reason] });
    }
  });
});
