import { describe, expect, it } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import {
  parseHydroUserActivities,
  parseHydroUserActivitiesJson,
} from "../../src/adapters/hydroj/parser";
import type { FetchInput, HttpClient, HttpResponse } from "../../src/domain";
import type { CollectionProgress } from "../../src/domain/sync-progress";

const origin = "https://oj.example.org";
const contest = "000000000000000000000010";
const homework = "000000000000000000000020";
const hidden = "000000000000000000000030";
const user = `<script>window.UserContext = '{"_id":42,"uname":"tester"}';</script>`;
const record = (id: number) => ({
  _id: id.toString(16).padStart(24, "0"),
  uid: 42,
  pid: "P1",
  status: 1,
  score: 100,
  submitAt: "2026-01-02T00:00:00Z",
});
const response = (url: string, text: string, status = 200): HttpResponse => ({
  url,
  text,
  status,
  contentType: text.startsWith("{") ? "application/json" : "text/html",
  headers: new Headers(),
});
function input(http: HttpClient, limit = 100): FetchInput {
  return {
    account: {
      accountId: "a",
      source: "hydroj",
      providerAccountKey: "42",
      identifier: "42",
      enabled: true,
      authMode: "browser-session",
      origin,
    },
    limit,
    since: 0,
    until: Date.parse("2026-01-03"),
    pagination: { runPage: ({ request }) => request() },
    now: Date.parse("2026-01-03"),
    signal: new AbortController().signal,
    requestId: "r",
    http,
  };
}

describe("Hydro activities", () => {
  it("parses only same-origin valid contest/homework links and removes badges", () => {
    const activities = parseHydroUserActivities(
      `<a href="/contest/${contest}">A &amp; B <span class="badge">OI</span></a><a href="/homework/${homework}">Homework</a><a href="/contest/${contest}">Duplicate</a><a href="https://other.org/contest/${hidden}">External</a><a href="/contest/bad">Bad</a>`,
      `${origin}/user/42`,
    );
    expect(activities).toEqual([
      {
        id: contest,
        title: "A & B",
        type: "contest",
        url: `${origin}/contest/${contest}`,
      },
      {
        id: homework,
        title: "Homework",
        type: "homework",
        url: `${origin}/homework/${homework}`,
      },
    ]);
    expect(
      parseHydroUserActivitiesJson(
        {
          tdocs: [
            { docId: contest, title: "Unknown rule", rule: "custom" },
            { docId: "bad", title: "Bad" },
          ],
        },
        origin,
      ),
    ).toEqual({
      activities: [{ id: contest, title: "Unknown rule", type: "other" }],
      invalidCount: 1,
    });
  });

  it("collects ordinary, contest and homework records, deduplicates before limit, and silently skips inaccessible activities", async () => {
    const requests: URL[] = [];
    const result = await hydroOJAdapter.fetchRecent(
      input(
        {
          async request(_source, url) {
            const parsed = new URL(url);
            requests.push(parsed);
            if (parsed.pathname.startsWith("/user/"))
              return response(
                url,
                JSON.stringify({
                  tdocs: [
                    { docId: contest, title: "Contest", rule: "oi" },
                    { docId: homework, title: "Homework", rule: "homework" },
                    { docId: hidden, title: "Hidden", rule: "oi" },
                  ],
                }),
              );
            const tid = parsed.searchParams.get("tid");
            const page = Number(parsed.searchParams.get("page"));
            if (tid === hidden) return response(url, "Forbidden", 403);
            if (!tid)
              return response(
                url,
                `<html data-page="record_main">${user}<tr data-rid="${record(1)._id}"><td class="col--status"><a class="record-status--text">100 Accepted</a></td><td class="col--problem"><a href="/p/1"><b>P1</b>One</a></td><td data-timestamp="1767312000"></td></tr></html>`,
              );
            const records =
              page > 1
                ? []
                : tid === contest
                  ? [record(1), record(2)]
                  : [record(3)];
            return response(url, JSON.stringify({ page, rdocs: records }));
          },
        },
        4,
      ),
    );
    expect(result.records).toHaveLength(3);
    expect(new Set(result.records.map((item) => item.submissionId)).size).toBe(
      3,
    );
    expect(
      result.records.filter((item) => item.activityType === "contest"),
    ).toHaveLength(2);
    expect(
      result.records.find((item) => item.activityType === "homework")
        ?.activityUrl,
    ).toBe(`${origin}/homework/${homework}`);
    expect(
      requests
        .filter((url) => url.searchParams.has("tid"))
        .every((url) => url.searchParams.get("uidOrName") === "42"),
    ).toBe(true);
    expect(
      requests.some(
        (url) =>
          url.searchParams.get("tid") === contest &&
          url.searchParams.get("page") === "2",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some((item) => item.context?.activityId === hidden),
    ).toBe(false);
    expect(result.coverage.outcome).toEqual({
      status: "complete",
      evidence: "all-streams",
    });
    expect(
      result.records.every(
        (item) => item.verdict.raw === "1" || item.verdict.raw === "Accepted",
      ),
    ).toBe(true);
  });

  it.each([1, 2, 3])(
    "silently completes when %s activities all return 403, without caching permission decisions",
    async (count) => {
      const ids = [contest, homework, hidden].slice(0, count);
      const requests: string[] = [];
      const updates: Partial<CollectionProgress>[] = [];
      const request = input({
        async request(_source, url) {
          requests.push(url);
          const parsed = new URL(url);
          if (parsed.pathname === "/") return response(url, user);
          if (parsed.pathname.startsWith("/user/"))
            return response(
              url,
              JSON.stringify({
                tdocs: ids.map((docId) => ({
                  docId,
                  title: "Private activity",
                  rule: "oi",
                })),
              }),
            );
          return parsed.searchParams.has("tid")
            ? response(url, "Forbidden", 403)
            : response(url, '{"page":1,"rdocs":[]}');
        },
      });
      request.onProgress = (update) => updates.push(update);
      const result = await hydroOJAdapter.fetchRecent(request);
      expect(result.records).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(result.activitySchedules).toEqual([]);
      expect(result.coverage).toMatchObject({
        pagesFetched: count + 2,
        outcome: { status: "complete", evidence: "all-streams" },
      });
      expect(
        requests.filter((url) => new URL(url).searchParams.has("tid")),
      ).toHaveLength(count);
      expect(
        updates
          .filter((update) => update.activitiesCompleted !== undefined)
          .map((update) => update.activitiesCompleted),
      ).toEqual(Array.from({ length: count + 1 }, (_, index) => index));
    },
  );

  it.each([false, true])(
    "keeps verified records and existing diagnostics when a later activity page returns 403 (invalid record: %s)",
    async (invalidRecord) => {
      const probes: string[] = [];
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
                  { docId: contest, title: "Contest", rule: "oi" },
                  { docId: homework, title: "Homework", rule: "homework" },
                ],
              }),
            );
          const tid = parsed.searchParams.get("tid");
          const page = Number(parsed.searchParams.get("page"));
          if (!tid) return response(url, '{"page":1,"rdocs":[]}');
          probes.push(`${tid}:${page}`);
          if (tid === contest && page === 2)
            return response(url, "Forbidden", 403);
          return response(
            url,
            JSON.stringify({
              page,
              rdocs:
                tid === contest
                  ? [record(1), ...(invalidRecord ? [{ _id: "bad" }] : [])]
                  : [record(2)],
              hasMore: tid === contest,
            }),
          );
        },
      });
      request.onProgress = (update) => updates.push(update);
      const result = await hydroOJAdapter.fetchRecent(request);
      expect(result.records).toHaveLength(2);
      expect(probes).toEqual([`${contest}:1`, `${contest}:2`, `${homework}:1`]);
      expect(
        result.diagnostics.some((item) => item.context?.activityId === contest),
      ).toBe(false);
      expect(result.diagnostics.map((item) => item.code)).toEqual([
        ...(invalidRecord ? ["record-invalid"] : []),
        `activity-${homework}`,
      ]);
      expect(result.coverage.outcome).toEqual(
        invalidRecord
          ? { status: "partial", reasons: ["invalid-record"] }
          : { status: "complete", evidence: "all-streams" },
      );
      expect(updates.at(-1)).toMatchObject({
        activitiesCompleted: 2,
        activitiesTotal: 2,
      });
    },
  );

  it.each([
    [401, "Forbidden", "auth-required"],
    [403, '<html data-page="user_login"></html>', "auth-required"],
    [404, "Not found", "unavailable"],
    [429, "Too many requests", "unavailable"],
    [500, "Server error", "unavailable"],
  ])(
    "retains activity errors for HTTP %s with body %s",
    async (status, body, activityStatus) => {
      const probes: string[] = [];
      const result = await hydroOJAdapter.fetchRecent(
        input({
          async request(_source, url) {
            const parsed = new URL(url);
            if (parsed.pathname === "/") return response(url, user);
            if (parsed.pathname.startsWith("/user/"))
              return response(
                url,
                JSON.stringify({
                  tdocs: [
                    { docId: contest, title: "Denied", rule: "oi" },
                    { docId: homework, title: "Readable", rule: "homework" },
                  ],
                }),
              );
            const tid = parsed.searchParams.get("tid");
            if (!tid) return response(url, '{"page":1,"rdocs":[]}');
            probes.push(tid);
            return tid === contest
              ? response(url, body, status)
              : response(url, '{"page":1,"rdocs":[]}');
          },
        }),
      );
      expect(result.coverage.outcome).toEqual({
        status: "partial",
        reasons: [status === 429 ? "rate-limited" : "unavailable"],
      });
      expect(
        result.diagnostics.find((item) => item.context?.activityId === contest),
      ).toMatchObject({
        severity: "warning",
        context: { status: activityStatus },
      });
      expect(probes).toEqual(status === 429 ? [contest] : [contest, homework]);
    },
  );

  it.each(["discovery", "ordinary-first", "ordinary-later"])(
    "does not silently ignore 403 in %s",
    async (stage) => {
      const request = input({
        async request(_source, url) {
          const parsed = new URL(url);
          if (parsed.pathname === "/") return response(url, user);
          if (parsed.pathname.startsWith("/user/"))
            return stage === "discovery"
              ? response(url, "Forbidden", 403)
              : response(url, '{"tdocs":[]}');
          const page = Number(parsed.searchParams.get("page"));
          if (
            stage === "ordinary-first" ||
            (stage === "ordinary-later" && page > 1)
          )
            return response(url, "Forbidden", 403);
          return response(
            url,
            JSON.stringify({
              page,
              rdocs: stage === "ordinary-later" ? [record(1)] : [],
            }),
          );
        },
      });
      if (stage === "ordinary-first") {
        await expect(hydroOJAdapter.fetchRecent(request)).rejects.toMatchObject(
          {
            error: { kind: "blocked", httpStatus: 403 },
          },
        );
        return;
      }
      const result = await hydroOJAdapter.fetchRecent(request);
      expect(result.coverage.outcome).toEqual({
        status: "partial",
        reasons: ["unavailable"],
      });
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code:
            stage === "discovery"
              ? "activity-discovery-failed"
              : "record-page-unavailable",
          severity: "warning",
        }),
      );
      if (stage === "ordinary-later") expect(result.records).toHaveLength(1);
    },
  );

  it("falls back to HTML when JSON has an unsupported shape", async () => {
    const accepts: string[] = [];
    const result = await hydroOJAdapter.fetchRecent(
      input({
        async request(_source, url, options) {
          accepts.push(options?.headers?.Accept ?? "");
          if (url.includes("/user/"))
            return response(
              url,
              '{"tdocs":[{"docId":"' +
                contest +
                '","title":"Contest","rule":"oi"}]}',
            );
          if (url.includes("tid="))
            return response(
              url,
              options?.headers?.Accept === "application/json"
                ? '{"different":true}'
                : '<html data-page="record_main"></html>',
            );
          return response(url, `<html data-page="record_main">${user}</html>`);
        },
      }),
    );
    expect(
      result.diagnostics.find((item) => item.context?.activityId === contest)
        ?.context?.status,
    ).toBe("empty");
    expect(accepts.slice(-2)).toEqual(["application/json", "text/html"]);
  });

  it("stops later activity probes once the shared unique output budget is full", async () => {
    const result = await hydroOJAdapter.fetchRecent(
      input(
        {
          async request(_source, url) {
            const parsed = new URL(url);
            if (parsed.pathname === "/") return response(url, user);
            if (parsed.pathname.startsWith("/user/"))
              return response(
                url,
                JSON.stringify({
                  tdocs: [
                    { docId: contest, title: "Contest", rule: "oi" },
                    { docId: homework, title: "Homework", rule: "homework" },
                  ],
                }),
              );
            const page = Number(parsed.searchParams.get("page"));
            const tid = parsed.searchParams.get("tid");
            return response(
              url,
              JSON.stringify({
                page,
                rdocs:
                  page > 1 ? [] : [record(!tid ? 1 : tid === contest ? 2 : 3)],
              }),
            );
          },
        },
        2,
      ),
    );
    expect(result.records).toHaveLength(2);
    expect(result.coverage.outcome).toEqual({
      status: "partial",
      reasons: ["record-limit"],
    });
    expect(
      result.diagnostics.some((item) => item.code === "record-limit"),
    ).toBe(false);
    expect(
      result.diagnostics
        .filter((item) => item.context?.activityId)
        .map((item) => item.context?.status),
    ).toEqual(["truncated", "unvisited"]);
  });

  it("does not discard ordinary records when activity discovery has a network failure", async () => {
    const result = await hydroOJAdapter.fetchRecent(
      input({
        async request(_source, url) {
          if (url.includes("/user/")) throw new Error("network");
          return response(url, `<html data-page="record_main">${user}</html>`);
        },
      }),
    );
    expect(result.account.providerAccountKey).toBe("42");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "activity-discovery-failed",
        severity: "warning",
      }),
    );
  });
});
