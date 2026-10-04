import { describe, expect, it } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import { parseHydroOJRecordPage } from "../../src/adapters/hydroj/parser";
import {
  ACTIVITY_SCHEDULE_TTL_MS,
  type ActivityScheduleRecord,
} from "../../src/domain/activity-schedule";
import type {
  FetchInput,
  HttpResponse,
  CollectionProgress,
} from "../../src/domain";

const origin = "https://school.example.org";
const activityId = "000000000000000000000010";
const now = Date.parse("2026-10-04T00:00:00Z");
const day = 86400_000;
const since = now - 7 * day;
const beginAt = now - 20 * day;
const endAt = now - 10 * day;
const tdoc = {
  docId: activityId,
  rule: "homework",
  beginAt: new Date(beginAt).toISOString(),
  endAt: new Date(endAt).toISOString(),
  penaltySince: new Date(now - 15 * day).toISOString(),
};
const schedule: ActivityScheduleRecord = {
  source: "hydroj",
  origin,
  activityId,
  beginAt,
  endAt,
  checkedAt: now,
};
function response(url: string, text: string, status = 200): HttpResponse {
  return {
    url,
    text,
    status,
    contentType: text.startsWith("{") ? "application/json" : "text/html",
    headers: new Headers(),
  };
}
function fixture(
  options: {
    metadata?: unknown;
    status?: number;
    ids?: string[];
    records?: object[];
  } = {},
) {
  const requests: string[] = [];
  const updates: Partial<CollectionProgress>[] = [];
  const input: FetchInput = {
    account: {
      accountId: "a",
      source: "hydroj",
      origin,
      enabled: true,
      authMode: "browser-session",
      providerAccountKey: "42",
    },
    now,
    since,
    until: now,
    limit: 1000,
    signal: new AbortController().signal,
    requestId: "r",
    pagination: { runPage: ({ request }) => request() },
    onProgress: (update) => updates.push(update),
    http: {
      async request(_source, url) {
        requests.push(url);
        const parsed = new URL(url);
        if (parsed.pathname === "/")
          return response(
            url,
            `<script>window.UserContext = '{"_id":42,"uname":"tester"}';</script>`,
          );
        if (parsed.pathname.startsWith("/user/"))
          return response(
            url,
            JSON.stringify({
              tdocs: (options.ids ?? [activityId]).map((docId) => ({
                docId,
                title: "Activity",
                rule: "homework",
              })),
            }),
          );
        if (!parsed.searchParams.has("tid"))
          return response(url, '{"page":1,"rdocs":[],"hasMore":false}');
        if (options.status) return response(url, "Unavailable", options.status);
        const page = Number(parsed.searchParams.get("page"));
        return response(
          url,
          JSON.stringify({
            page,
            tdoc: options.metadata ?? tdoc,
            rdocs: page === 1 ? (options.records ?? []) : [],
            hasMore: page === 1,
          }),
        );
      },
    },
  };
  return {
    input,
    requests,
    updates,
    probes: () =>
      requests.filter((url) => new URL(url).searchParams.has("tid")),
  };
}

describe("Hydro activity schedule optimization", () => {
  it("reuses the first record response for timing, without requesting details or an extra record page", async () => {
    const f = fixture({
      records: [
        {
          _id: "1".repeat(24),
          uid: 42,
          pid: 1,
          status: 1,
          submitAt: new Date(endAt - day).toISOString(),
        },
      ],
    });
    const result = await hydroOJAdapter.fetchRecent(f.input);
    expect(f.probes()).toHaveLength(1);
    expect(f.requests).toHaveLength(4);
    expect(result.activitySchedules).toEqual([schedule]);
    expect(result.coverage.outcome.status).toBe("complete");
  });
  it("completes normally when skipping fresh historical schedules without HTTP or refreshing their checkedAt", async () => {
    const f = fixture();
    f.input.activitySchedules = [schedule];
    const result = await hydroOJAdapter.fetchRecent(f.input);
    expect(f.probes()).toHaveLength(0);
    expect(result.activitySchedules).toEqual([]);
    expect(result.coverage).toMatchObject({
      pagesFetched: 2,
      outcome: { status: "complete", evidence: "all-streams" },
    });
    expect(f.updates.at(-1)).toMatchObject({
      activitiesCompleted: 1,
      activitiesTotal: 1,
    });
    expect(result.diagnostics.at(-1)?.context?.status).toBe(
      "cached-outside-window",
    );
    expect(result.diagnostics.every((item) => item.severity === "info")).toBe(
      true,
    );
  });
  it.each([
    "expired",
    "recheck",
    "wider",
    "boundary",
    "other-domain",
    "other-origin",
    "future-check",
  ])("probes instead of skipping with %s evidence", async (variant) => {
    const f = fixture();
    const entry = { ...schedule };
    if (variant === "expired") entry.checkedAt -= ACTIVITY_SCHEDULE_TTL_MS;
    if (variant === "recheck") f.input.recheckActivities = true;
    if (variant === "wider") Object.assign(f.input, { since: now - 35 * day });
    if (variant === "boundary") Object.assign(f.input, { since: endAt });
    if (variant === "other-domain") entry.domainId = "student";
    if (variant === "other-origin") entry.origin = "https://other.example.org";
    if (variant === "future-check") entry.checkedAt += 1;
    f.input.activitySchedules = [entry];
    const result = await hydroOJAdapter.fetchRecent(f.input);
    expect(f.probes().length).toBeGreaterThan(0);
    expect(result.coverage.outcome.status).toBe("complete");
  });
  it("respects the final homework endAt including extensions, not penaltySince", async () => {
    const f = fixture({
      metadata: { ...tdoc, endAt: new Date(now + day).toISOString() },
    });
    const result = await hydroOJAdapter.fetchRecent(f.input);
    expect(result.activitySchedules?.[0]?.endAt).toBe(now + day);
  });
  it("discovers an extension after cache expiry and collects newly visible submissions", async () => {
    const time = now - day;
    const f = fixture({
      metadata: { ...tdoc, endAt: new Date(now + day).toISOString() },
      records: [
        {
          _id: Math.floor(time / 1000).toString(16) + "0".repeat(16),
          uid: 42,
          pid: 1,
          status: 1,
        },
      ],
    });
    f.input.activitySchedules = [
      { ...schedule, checkedAt: now - ACTIVITY_SCHEDULE_TTL_MS },
    ];
    const result = await hydroOJAdapter.fetchRecent(f.input);
    expect(result.records).toHaveLength(1);
    expect(result.activitySchedules?.[0]?.endAt).toBe(now + day);
    expect(result.coverage.outcome.status).toBe("complete");
  });
  it.each(["deadline", "cancelled"])(
    "handles %s after a verified activity without inventing further observations",
    async (kind) => {
      const nextId = "000000000000000000000020";
      const f = fixture({ ids: [activityId, nextId] });
      const controller = new AbortController();
      f.input.signal = controller.signal;
      const request = f.input.http.request;
      f.input.http.request = async (source, url, options) => {
        if (new URL(url).searchParams.get("tid") === nextId) {
          controller.abort({ kind });
          throw new DOMException("Aborted", "AbortError");
        }
        return request(source, url, options);
      };
      if (kind === "deadline") {
        const result = await hydroOJAdapter.fetchRecent(f.input);
        expect(result.activitySchedules).toEqual([schedule]);
        expect(result.coverage.outcome).toEqual({
          status: "partial",
          reasons: ["deadline"],
        });
      } else {
        await expect(hydroOJAdapter.fetchRecent(f.input)).rejects.toMatchObject(
          { name: "AbortError" },
        );
      }
    },
  );
  it.each([
    {},
    { ...tdoc, docId: "0".repeat(24) },
    { ...tdoc, endAt: "bad" },
    { ...tdoc, beginAt: tdoc.endAt },
    { ...tdoc, rule: "custom" },
  ])(
    "does not cache a skipping decision from unsupported timing %j",
    async (metadata) => {
      const f = fixture({ metadata });
      const result = await hydroOJAdapter.fetchRecent(f.input);
      expect(result.activitySchedules?.[0]?.endAt).toBeUndefined();
      expect(result.coverage.outcome.status).toBe("complete");
    },
  );
  it("revokes timing contradicted by a recent record and keeps the record", async () => {
    const time = now - day;
    const f = fixture({
      records: [
        {
          _id: Math.floor(time / 1000).toString(16) + "0".repeat(16),
          uid: 42,
          pid: 1,
          status: 1,
        },
      ],
    });
    const result = await hydroOJAdapter.fetchRecent(f.input);
    expect(result.records).toHaveLength(1);
    expect(result.activitySchedules?.[0]?.endAt).toBeUndefined();
    expect(f.probes()).toHaveLength(2);
  });
  it.each([403, 404, 429])(
    "does not create schedule evidence on HTTP %s",
    async (status) => {
      const f = fixture({ status });
      const result = await hydroOJAdapter.fetchRecent(f.input);
      expect(result.activitySchedules).toEqual([]);
      expect(result.coverage.outcome.status).toBe(
        status === 403 ? "complete" : "partial",
      );
      if (status === 403) expect(result.diagnostics).toEqual([]);
    },
  );
  it("does not let cached historical activities exhaust the 50 actual-probe limit", async () => {
    const ids = Array.from({ length: 51 }, (_, n) =>
      n.toString(16).padStart(24, "0"),
    );
    const f = fixture({ ids });
    f.input.activitySchedules = ids
      .slice(0, 50)
      .map((id) => ({ ...schedule, activityId: id }));
    const result = await hydroOJAdapter.fetchRecent(f.input);
    expect(f.probes()).toHaveLength(1);
    expect(new URL(f.probes()[0]!).searchParams.get("tid")).toBe(ids[50]);
    expect(result.coverage.outcome).toEqual({
      status: "complete",
      evidence: "all-streams",
    });
  });
  it.each([403, 404, 429, 500])(
    "keeps HTTP %s semantics when another activity is excluded by cache",
    async (status) => {
      const nextId = "000000000000000000000020";
      const f = fixture({ ids: [activityId, nextId], status });
      f.input.activitySchedules = [schedule];
      const result = await hydroOJAdapter.fetchRecent(f.input);
      expect(f.probes()).toHaveLength(1);
      expect(new URL(f.probes()[0]!).searchParams.get("tid")).toBe(nextId);
      expect(result.coverage.outcome).toEqual(
        status === 403
          ? { status: "complete", evidence: "all-streams" }
          : {
              status: "partial",
              reasons: [status === 429 ? "rate-limited" : "unavailable"],
            },
      );
      expect(f.updates.at(-1)).toMatchObject({
        activitiesCompleted: 2,
        activitiesTotal: 2,
      });
      expect(
        result.diagnostics.filter((item) => item.severity === "warning"),
      ).toHaveLength(status === 403 ? 0 : 1);
    },
  );
  it("still caps unknown activity probes at 50 and reports the remaining activities unvisited", async () => {
    const ids = Array.from({ length: 51 }, (_, n) =>
      n.toString(16).padStart(24, "0"),
    );
    const f = fixture({ ids });
    const result = await hydroOJAdapter.fetchRecent(f.input);
    expect(f.probes()).toHaveLength(50);
    expect(result.coverage.outcome).toEqual({
      status: "partial",
      reasons: ["activity-limit"],
    });
    expect(result.diagnostics.at(-1)).toMatchObject({
      context: { activityId: ids[50], status: "unvisited" },
    });
  });
  it("only accepts matching domain metadata", () => {
    const page = parseHydroOJRecordPage(
      JSON.stringify({
        page: 1,
        rdocs: [],
        tdoc: { ...tdoc, domainId: "other" },
      }),
      `${origin}/d/student/record?tid=${activityId}`,
    );
    expect(page.activitySchedule).toBeUndefined();
  });
});
