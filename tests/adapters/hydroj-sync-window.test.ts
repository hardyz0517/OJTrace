import { immediatePagination } from "../helpers/fetch-input";
import { httpResponse as response } from "../helpers/http-response";
import { describe, expect, it } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import type { FetchInput, HttpClient, HttpResponse } from "../../src/domain";
import type { CollectionProgress } from "../../src/domain/sync-progress";

const origin = "https://window.example.org";
const since = Date.parse("2026-01-02T00:00:00Z");
const until = Date.parse("2026-01-03T00:00:00Z");
const hour = 3600_000;
const activity = "000000000000000000000010";
const anotherActivity = "000000000000000000000020";
const user =
  '<script>window.UserContext = \'{"_id":42,"uname":"tester"}\';</script>';
function oid(time: number, suffix = 1) {
  return (
    Math.floor(time / 1000)
      .toString(16)
      .padStart(8, "0") + suffix.toString(16).padStart(16, "0")
  );
}
function raw(time: number, suffix = 1) {
  return { _id: oid(time, suffix), uid: 42, pid: suffix, status: 1 };
}

function input(http: HttpClient): FetchInput {
  return {
    account: {
      accountId: "a",
      source: "hydroj",
      providerAccountKey: "42",
      authMode: "browser-session",
      enabled: true,
      origin,
    },
    since,
    until,
    now: until + 24 * hour,
    limit: 1000,
    signal: new AbortController().signal,
    requestId: "r",
    http,
    pagination: immediatePagination(),
  };
}
function httpWithPages(
  get: (page: number, url: string) => Promise<HttpResponse> | HttpResponse,
  calls: string[] = [],
): HttpClient {
  return {
    async request(_source, url) {
      calls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === "/") return response(url, user);
      if (parsed.pathname.startsWith("/user/"))
        return response(url, '{"tdocs":[]}');
      return get(Number(parsed.searchParams.get("page")), url);
    },
  };
}

describe("Hydro collection window and bounded coverage", () => {
  it("positions past records newer than until, then stops at a trusted descending ObjectId boundary", async () => {
    const calls: string[] = [];
    const request = input(
      httpWithPages(
        (page, url) =>
          response(
            url,
            JSON.stringify({
              page,
              rdocs:
                page === 1
                  ? [raw(until + hour)]
                  : [raw(since + hour, 2), raw(since - hour, 3)],
            }),
          ),
        calls,
      ),
    );
    request.limit = 1;
    const result = await hydroOJAdapter.fetchRecent(request);
    expect(result.records.map((record) => record.submissionId)).toEqual([
      oid(since + hour, 2),
    ]);
    expect(
      calls.filter((url) => new URL(url).pathname === "/record"),
    ).toHaveLength(2);
    expect(calls.some((url) => url.includes("/user/"))).toBe(false);
    expect(result.coverage).toMatchObject({
      window: { since, until },
      pagesFetched: 2,
      acceptedRecords: 1,
      outcome: { status: "partial", reasons: ["record-limit"] },
    });
  });

  it("includes both boundaries and stops without fetching an extra list page", async () => {
    const calls: string[] = [];
    const result = await hydroOJAdapter.fetchRecent(
      input(
        httpWithPages(
          (page, url) =>
            response(
              url,
              JSON.stringify({
                page,
                rdocs: [raw(until, 3), raw(since, 2), raw(since - hour, 1)],
              }),
            ),
          calls,
        ),
      ),
    );
    expect(result.records.map((record) => record.submittedAt)).toEqual([
      until,
      since,
    ]);
    expect(result.coverage).toMatchObject({
      pagesFetched: 2,
      outcome: { status: "complete", evidence: "all-streams" },
    });
    expect(
      calls.filter((url) => new URL(url).pathname === "/record"),
    ).toHaveLength(1);
  });

  it("disables boundary stopping when a page contradicts descending ObjectId order", async () => {
    const calls: string[] = [];
    const result = await hydroOJAdapter.fetchRecent(
      input(
        httpWithPages(
          (page, url) =>
            response(
              url,
              JSON.stringify({
                page,
                rdocs:
                  page === 1
                    ? [raw(since - hour, 1), raw(until - hour, 2)]
                    : page === 2
                      ? [raw(since + hour, 3)]
                      : [],
              }),
            ),
          calls,
        ),
      ),
    );
    expect(result.records).toHaveLength(2);
    expect(
      calls.filter((url) => new URL(url).pathname === "/record"),
    ).toHaveLength(3);
    expect(result.coverage.outcome.status).toBe("complete");
  });

  it("marks an invalid timestamp partial and keeps collecting instead of using it as a stopping boundary", async () => {
    const calls: string[] = [];
    const result = await hydroOJAdapter.fetchRecent(
      input(
        httpWithPages(
          (page, url) =>
            response(
              url,
              JSON.stringify({
                page,
                rdocs:
                  page === 1
                    ? [{ ...raw(since - hour), submitAt: -1 }]
                    : page === 2
                      ? [raw(since + hour, 2)]
                      : [],
              }),
            ),
          calls,
        ),
      ),
    );
    expect(result.records).toHaveLength(1);
    expect(
      calls.filter((url) => new URL(url).pathname === "/record"),
    ).toHaveLength(3);
    expect(result.coverage.outcome).toEqual({
      status: "partial",
      reasons: ["invalid-record"],
    });
  });

  it("keeps verified records on a later 429 and sends no discovery or activity requests afterward", async () => {
    const calls: string[] = [];
    const result = await hydroOJAdapter.fetchRecent(
      input(
        httpWithPages(
          (page, url) =>
            page === 1
              ? response(
                  url,
                  JSON.stringify({ page, rdocs: [raw(until - hour)] }),
                )
              : response(url, "Too many requests", 429),
          calls,
        ),
      ),
    );
    expect(result.records).toHaveLength(1);
    expect(result.coverage).toMatchObject({
      pagesFetched: 2,
      outcome: { status: "partial", reasons: ["rate-limited"] },
    });
    expect(calls.some((url) => url.includes("/user/"))).toBe(false);
  });

  it("throws an initial list failure rather than fabricating an empty partial sync", async () => {
    const calls: string[] = [];
    await expect(
      hydroOJAdapter.fetchRecent(
        input(
          httpWithPages(
            (_page, url) => response(url, "Too many requests", 429),
            calls,
          ),
        ),
      ),
    ).rejects.toMatchObject({ error: { kind: "rate_limited" } });
    expect(calls).toHaveLength(2);
  });

  it("does not accept a record belonging to a different user", async () => {
    await expect(
      hydroOJAdapter.fetchRecent(
        input(
          httpWithPages((page, url) =>
            response(
              url,
              JSON.stringify({
                page,
                rdocs: [{ ...raw(until - hour), uid: 99 }],
              }),
            ),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      error: { messageKey: "account.identityChanged" },
    });
  });

  it.each([
    ["deadline", { kind: "deadline" }, true],
    ["user cancellation", { kind: "cancelled" }, false],
  ])(
    "handles %s separately after one verified page",
    async (_name, reason, partial) => {
      const controller = new AbortController();
      const calls: string[] = [];
      const request = input(
        httpWithPages((page, url) => {
          if (page === 1)
            return response(
              url,
              JSON.stringify({ page, rdocs: [raw(until - hour)] }),
            );
          controller.abort(reason);
          throw new DOMException("Cancelled", "AbortError");
        }, calls),
      );
      request.signal = controller.signal;
      const result = hydroOJAdapter.fetchRecent(request);
      if (partial) {
        await expect(result).resolves.toMatchObject({
          records: [expect.any(Object)],
          coverage: { outcome: { status: "partial", reasons: ["deadline"] } },
        });
      } else {
        await expect(result).rejects.toMatchObject({ name: "AbortError" });
      }
      expect(calls.some((url) => url.includes("/user/"))).toBe(false);
    },
  );

  it("caps the account's logical pages at 100 before starting activity discovery", async () => {
    const calls: string[] = [];
    const result = await hydroOJAdapter.fetchRecent(
      input(
        httpWithPages(
          (page, url) =>
            response(
              url,
              JSON.stringify({
                page,
                rdocs: [{ ...raw(until + hour, page), submitAt: until + hour }],
              }),
            ),
          calls,
        ),
      ),
    );
    expect(result.records).toHaveLength(0);
    expect(result.coverage).toMatchObject({
      pagesFetched: 100,
      outcome: { status: "partial", reasons: ["page-limit"] },
    });
    expect(
      calls.filter((url) => new URL(url).pathname === "/record"),
    ).toHaveLength(100);
    expect(calls.some((url) => url.includes("/user/"))).toBe(false);
  });

  it("stops activity scheduling after the first activity is rate limited", async () => {
    const calls: string[] = [];
    const result = await hydroOJAdapter.fetchRecent(
      input({
        async request(_source, url) {
          calls.push(url);
          const parsed = new URL(url);
          if (parsed.pathname === "/") return response(url, user);
          if (parsed.pathname.startsWith("/user/"))
            return response(
              url,
              JSON.stringify({
                tdocs: [
                  { docId: activity, title: "First", rule: "oi" },
                  { docId: anotherActivity, title: "Second", rule: "homework" },
                ],
              }),
            );
          if (!parsed.searchParams.has("tid"))
            return response(url, '{"page":1,"rdocs":[],"hasMore":false}');
          return response(url, "Too many requests", 429);
        },
      }),
    );
    expect(result.coverage).toMatchObject({
      pagesFetched: 3,
      outcome: { status: "partial", reasons: ["rate-limited"] },
    });
    expect(
      calls.filter((url) => new URL(url).searchParams.has("tid")),
    ).toHaveLength(1);
    expect(
      result.diagnostics.find(
        (item) => item.context?.activityId === anotherActivity,
      )?.context?.status,
    ).toBe("unvisited");
  });

  it("does not turn a 429 identity response into successful authorization", async () => {
    const request = input({
      async request(_source, url) {
        return response(url, user, 429);
      },
    });
    await expect(hydroOJAdapter.authorize(request)).rejects.toMatchObject({
      error: { kind: "rate_limited" },
    });
  });

  it("keeps same-page password recovery inside one logical page callback", async () => {
    let insidePage = false;
    let pageRequests = 0;
    const pageOrigins: string[] = [];
    const request = input({
      async request(_source, url) {
        const parsed = new URL(url);
        if (parsed.pathname === "/") return response(url, user);
        expect(insidePage).toBe(true);
        if (parsed.pathname === "/login") return response(url, user);
        if (parsed.pathname.startsWith("/user/"))
          return response(url, '{"tdocs":[]}');
        pageRequests += 1;
        return pageRequests === 1
          ? response(url, '<html data-page="user_login"></html>', 401)
          : response(url, '{"page":1,"rdocs":[]}');
      },
    });
    request.account.authMode = "password";
    request.credentials = { username: "tester", password: "fake-password" };
    const updates: Partial<CollectionProgress>[] = [];
    request.onProgress = (update) => updates.push(update);
    request.pagination = {
      async runPage({ origin, request: run }) {
        pageOrigins.push(origin);
        expect(insidePage).toBe(false);
        insidePage = true;
        try {
          return await run();
        } finally {
          insidePage = false;
        }
      },
    };
    const result = await hydroOJAdapter.fetchRecent(request);
    expect(pageRequests).toBe(2);
    expect(pageOrigins).toEqual([origin, origin]);
    expect(result.coverage).toMatchObject({
      pagesFetched: 2,
      outcome: { status: "complete" },
    });
    expect(
      updates
        .filter((update) => (update.pagesFetched ?? 0) > 0)
        .map((update) => update.pagesFetched),
    ).toEqual([1, 2]);
  });

  it("uses one shared 100-page budget across ordinary lists, discovery and activities", async () => {
    const activityIds = Array.from({ length: 25 }, (_, index) =>
      (index + 100).toString(16).padStart(24, "0"),
    );
    const calls: string[] = [];
    const result = await hydroOJAdapter.fetchRecent(
      input({
        async request(_source, url) {
          calls.push(url);
          const parsed = new URL(url);
          if (parsed.pathname === "/") return response(url, user);
          if (parsed.pathname.startsWith("/user/"))
            return response(
              url,
              JSON.stringify({
                tdocs: activityIds.map((docId) => ({
                  docId,
                  title: "Activity",
                  rule: "oi",
                })),
              }),
            );
          if (!parsed.searchParams.has("tid"))
            return response(url, '{"page":1,"rdocs":[]}');
          const page = Number(parsed.searchParams.get("page"));
          return response(
            url,
            JSON.stringify({
              page,
              rdocs: [{ ...raw(until + hour, page), submitAt: until + hour }],
            }),
          );
        },
      }),
    );
    expect(result.coverage).toMatchObject({
      pagesFetched: 100,
      outcome: { status: "partial", reasons: ["page-limit"] },
    });
    expect(calls.filter((url) => new URL(url).pathname !== "/")).toHaveLength(
      100,
    );
    expect(
      calls.some(
        (url) => new URL(url).searchParams.get("tid") === activityIds[20],
      ),
    ).toBe(false);
    expect(
      result.diagnostics.some((item) => item.context?.status === "unvisited"),
    ).toBe(true);
  });

  it("reports each logical page once with the shared unique in-window count and actual activity attempts", async () => {
    const updates: Partial<CollectionProgress>[] = [];
    const request = input({
      async request(_source, url) {
        const parsed = new URL(url);
        if (parsed.pathname === "/") return response(url, user);
        if (parsed.pathname.startsWith("/user/"))
          return response(
            url,
            JSON.stringify({
              tdocs: [
                { docId: activity, title: "First", rule: "oi" },
                { docId: anotherActivity, title: "Second", rule: "homework" },
              ],
            }),
          );
        const tid = parsed.searchParams.get("tid");
        const records =
          tid === activity
            ? [raw(since + hour, 1), raw(since + hour, 2)]
            : tid === anotherActivity
              ? [raw(since + hour, 3)]
              : [raw(until + hour, 4), raw(since + hour, 1)];
        return response(
          url,
          JSON.stringify({ page: 1, rdocs: records, hasMore: false }),
        );
      },
    });
    request.onProgress = (update) => updates.push(update);
    const result = await hydroOJAdapter.fetchRecent(request);
    expect(result.records).toHaveLength(3);
    expect(updates.filter((update) => (update.pagesFetched ?? 0) > 0)).toEqual([
      { phase: "list", pagesFetched: 1, recordsFetched: 1 },
      { phase: "activities", pagesFetched: 2, recordsFetched: 1 },
      { phase: "activities", pagesFetched: 3, recordsFetched: 2 },
      { phase: "activities", pagesFetched: 4, recordsFetched: 3 },
    ]);
    expect(
      updates.filter((update) => update.activitiesTotal !== undefined),
    ).toEqual([
      { phase: "activities", activitiesCompleted: 0, activitiesTotal: 2 },
      { phase: "activities", activitiesCompleted: 1, activitiesTotal: 2 },
      { phase: "activities", activitiesCompleted: 2, activitiesTotal: 2 },
    ]);
    expect(updates[0]).toEqual({ phase: "identity" });
    expect(result.coverage.pagesFetched).toBe(4);
  });

  it("does not count rate-limited unvisited activities as completed progress", async () => {
    const updates: Partial<CollectionProgress>[] = [];
    const request = input({
      async request(_source, url) {
        const parsed = new URL(url);
        if (parsed.pathname === "/") return response(url, user);
        if (parsed.pathname.startsWith("/user/"))
          return response(
            url,
            JSON.stringify({
              tdocs: [
                { docId: activity, title: "First", rule: "oi" },
                { docId: anotherActivity, title: "Second", rule: "oi" },
              ],
            }),
          );
        if (parsed.searchParams.has("tid"))
          return response(url, "Rate limited", 429);
        return response(url, '{"page":1,"rdocs":[]}');
      },
    });
    request.onProgress = (update) => updates.push(update);
    const result = await hydroOJAdapter.fetchRecent(request);
    expect(result.coverage.outcome.status).toBe("partial");
    expect(
      updates
        .filter((update) => update.activitiesCompleted !== undefined)
        .map((update) => update.activitiesCompleted),
    ).toEqual([0, 1]);
    expect(
      updates
        .filter((update) => (update.pagesFetched ?? 0) > 0)
        .map((update) => update.pagesFetched),
    ).toEqual([1, 2, 3]);
    expect(updates.at(-1)).toMatchObject({
      activitiesTotal: 2,
      activitiesCompleted: 1,
    });
  });

  it("keeps collection successful when the progress observer throws", async () => {
    const request = input(
      httpWithPages((_page, url) => response(url, '{"page":1,"rdocs":[]}')),
    );
    request.onProgress = () => {
      throw new Error("Disconnected UI");
    };
    await expect(hydroOJAdapter.fetchRecent(request)).resolves.toMatchObject({
      coverage: { pagesFetched: 2, outcome: { status: "complete" } },
    });
  });
});
