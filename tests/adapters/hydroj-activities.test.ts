import { describe, expect, it } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import {
  parseHydroUserActivities,
  parseHydroUserActivitiesJson,
} from "../../src/adapters/hydroj/parser";
import type { FetchInput, HttpClient, HttpResponse } from "../../src/domain";

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

  it("collects ordinary, contest and homework records, deduplicates before limit, and preserves partial success", async () => {
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
        3,
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
      result.diagnostics.find((item) => item.context?.activityId === hidden)
        ?.context?.status,
    ).toBe("permission-denied");
    expect(
      result.records.every(
        (item) => item.verdict.raw === "1" || item.verdict.raw === "Accepted",
      ),
    ).toBe(true);
  });

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

  it("reports the total output limit even when all individual lists are complete", async () => {
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
    expect(result.hasMore).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "output-limit", severity: "warning" }),
    );
    expect(
      result.diagnostics.some((item) => item.code === "record-limit"),
    ).toBe(false);
    expect(
      result.diagnostics
        .filter((item) => item.context?.activityId)
        .every((item) => item.context?.status === "synced"),
    ).toBe(true);
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
