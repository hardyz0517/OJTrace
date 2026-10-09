import { immediatePagination } from "../helpers/fetch-input";
import { httpResponse as response } from "../helpers/http-response";
import { describe, expect, it } from "vitest";
import type { FetchInput, HttpClient } from "../../src/domain";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import {
  createHydroOJInstance,
  hydroOJRecordsUrl,
  hydroOJUserUrl,
} from "../../src/adapters/hydroj/instance";
import {
  parseHydroOJRecordPage,
  parseHydroUserActivities,
  parseHydroUserActivitiesJson,
} from "../../src/adapters/hydroj/parser";
import {
  hydroDomainPrefix,
  hydroScopedUrl,
} from "../../src/domain/hydro-scope";

const origin = "http://hydro.example.org";
const tid = "6940ba67fb0f033a69e00504";
const home = (uid = 42, domainId = "student") =>
  `<script>window.UserContext = '{"_id":${uid},"uname":"tester"}'; window.UiContext = '{"domainId":"${domainId}"}';</script>`;

function input(http: HttpClient): FetchInput {
  return {
    account: {
      source: "hydroj",
      accountId: "student-account",
      origin,
      domainId: "student",
      providerAccountKey: "42",
      enabled: true,
      authMode: "browser-session",
    },
    http,
    signal: new AbortController().signal,
    requestId: "domain-test",
    now: Date.parse("2026-10-04T00:00:00Z"),
    limit: 100,
    since: Date.parse("2026-09-01T00:00:00Z"),
    until: Date.parse("2026-10-04T00:00:00Z"),
    pagination: immediatePagination(),
  };
}
function record(id: string, overrides = {}) {
  return {
    _id: id,
    uid: 42,
    domainId: "student",
    pid: 1,
    status: 1,
    submitAt: "2026-09-28T00:00:00Z",
    ...overrides,
  };
}
const rid = "6831d68a5546fddf447ad313";

describe("Hydro explicit domain scope", () => {
  it("normalizes root and domain input while retaining transport origin", () => {
    for (const path of ["/d/student", "/d/student/"])
      expect(createHydroOJInstance(`${origin}${path}`)).toEqual({
        origin,
        domainId: "student",
        kind: "custom",
      });
    expect(createHydroOJInstance(origin, "student").domainId).toBe("student");
    expect(hydroScopedUrl({ origin, domainId: "student" })).toBe(
      `${origin}/d/student/`,
    );
    expect(hydroOJRecordsUrl(origin, "42", 2, "student")).toBe(
      `${origin}/d/student/record?uidOrName=42&page=2`,
    );
    expect(hydroOJUserUrl(origin, "42", "student")).toBe(
      `${origin}/d/student/user/42`,
    );
  });

  it.each([
    "/d/",
    "/d/student/record",
    "/d/student/?x=1",
    "/d/student/#x",
    "/d/a%2Fb/",
    "/d/%2e%2e/",
    "/d/student/../..",
    "/d/student\\..\\..",
    "/d/student//",
    "/d/%/",
  ])("rejects ambiguous domain address %s", (path) => {
    expect(() => createHydroOJInstance(`${origin}${path}`)).toThrow();
  });
  it("rejects conflicting or invalid explicit domains", () => {
    expect(() =>
      createHydroOJInstance(`${origin}/d/student/`, "other"),
    ).toThrow();
    for (const domain of [
      "",
      "../other",
      "a/b",
      "a?b",
      " student",
      "a".repeat(65),
    ])
      expect(() => createHydroOJInstance(origin, domain)).toThrow();
  });

  it("keeps JSON record and activity links in the requested domain", () => {
    const url = `${origin}/d/student/record?tid=${tid}`;
    const page = parseHydroOJRecordPage(
      JSON.stringify({
        page: 1,
        rdocs: [record(rid)],
        pdict: { 1: { docId: 1, pid: "T19", title: "Donation" } },
      }),
      url,
    );
    expect(page.rdocs[0]).toMatchObject({
      pid: "T19",
      problemName: "Donation",
      problemUrl: `/d/student/p/1?tid=${tid}`,
      submissionUrl: `/d/student/record/${rid}`,
    });
    const activities = parseHydroUserActivitiesJson(
      { tdocs: [{ docId: tid, title: "Homework", rule: "homework" }] },
      `${origin}/d/student/user/42`,
    );
    expect(activities.activities[0]?.url).toBe(
      `${origin}/d/student/homework/${tid}`,
    );
  });

  it("discovers only same-domain HTML activities and keeps HTML navigation", () => {
    const activities = parseHydroUserActivities(
      `
      <a href="/d/student/homework/${tid}">Homework</a>
      <a href="/d/other/contest/6940ba67fb0f033a69e00505">Wrong domain</a>
      <a href="/contest/6940ba67fb0f033a69e00506">Root</a>
      <a href="https://other.example.org/d/student/contest/6940ba67fb0f033a69e00507">Other host</a>
    `,
      `${origin}/d/student/user/42`,
    );
    expect(activities).toHaveLength(1);
    expect(activities[0]?.url).toBe(`${origin}/d/student/homework/${tid}`);
    const page = parseHydroOJRecordPage(
      `<html data-page="record_main"><tr data-rid="${rid}"><td class="col--problem"><a href="/d/student/p/1?tid=${tid}"><b>T19</b> Donation</a></td></tr></html>`,
      `${origin}/d/student/record`,
    );
    expect(page.rdocs[0]).toMatchObject({
      submissionUrl: `/d/student/record/${rid}`,
      problemUrl: `/d/student/p/1?tid=${tid}`,
    });
  });

  it("collects ordinary, contest and homework pages without dropping the prefix", async () => {
    const requests: string[] = [];
    const origins: string[] = [];
    const activities = [
      { docId: tid, title: "Homework", rule: "homework" },
      { docId: "6940ba67fb0f033a69e00505", title: "Contest", rule: "oi" },
    ];
    const http: HttpClient = {
      async request(_source, url, options) {
        requests.push(url);
        expect(options?.hydroOrigin).toBe(origin);
        const path = new URL(url).pathname;
        expect(path.startsWith("/d/student/")).toBe(true);
        if (path === "/d/student/") return response(url, home());
        if (path.endsWith("/user/42"))
          return response(url, JSON.stringify({ tdocs: activities }));
        const params = new URL(url).searchParams;
        const activityId = params.get("tid");
        const page = Number(params.get("page"));
        const id = activityId
          ? activityId === tid
            ? "6831d68a5546fddf447ad314"
            : "6831d68a5546fddf447ad315"
          : rid;
        return response(
          url,
          JSON.stringify({
            page,
            rdocs:
              page === 1
                ? [record(id, activityId ? { contest: activityId } : {})]
                : [],
            pdict: { 1: { docId: 1, title: "Problem" } },
          }),
        );
      },
    };
    const request = input(http);
    request.pagination = {
      runPage: ({ origin, request }) => {
        origins.push(origin);
        return request();
      },
    };
    const result = await hydroOJAdapter.fetchRecent(request);
    expect(result.coverage.outcome.status).toBe("complete");
    expect(result.records).toHaveLength(3);
    expect(
      result.records
        .map((item) => item.activityType)
        .filter(Boolean)
        .sort(),
    ).toEqual(["contest", "homework"]);
    for (const item of result.records) {
      expect(item.domainId).toBe("student");
      expect(item.problemUrl).toContain(`${origin}/d/student/p/1`);
      expect(item.submissionUrl).toContain(`${origin}/d/student/record/`);
      expect(item.fallbackListUrl).toContain(`${origin}/d/student/record?`);
    }
    expect(origins.every((value) => value === origin)).toBe(true);
    expect(
      requests.filter((url) => new URL(url).searchParams.get("page") === "2"),
    ).toHaveLength(3);
  });

  it.each(["root-redirect", "wrong-context", "wrong-record"])(
    "fails closed on %s",
    async (mode) => {
      const http: HttpClient = {
        async request(_source, url) {
          if (url.endsWith("/d/student/")) {
            if (mode === "root-redirect")
              return response(`${origin}/`, home(42, "system"));
            return response(
              url,
              home(42, mode === "wrong-context" ? "other" : "student"),
            );
          }
          return response(
            url,
            JSON.stringify({
              page: 1,
              rdocs: [record(rid, { domainId: "other" })],
            }),
          );
        },
      };
      await expect(
        hydroOJAdapter.fetchRecent(input(http)),
      ).rejects.toMatchObject({
        error: { kind: "invalid_response", messageKey: "source.scopeMismatch" },
      });
    },
  );

  it.each([403, 404])(
    "does not authorize an inaccessible domain (HTTP %s)",
    async (status) => {
      const requests: string[] = [];
      const http: HttpClient = {
        async request(_source, url) {
          requests.push(url);
          return response(url, home(), status);
        },
      };
      await expect(hydroOJAdapter.authorize(input(http))).rejects.toBeDefined();
      expect(requests).toEqual([`${origin}/d/student/`]);
    },
  );

  it("keeps password login and expiry recovery inside the selected domain", async () => {
    let loggedIn = false;
    let logins = 0;
    let expireList = true;
    const http: HttpClient = {
      async request(_source, url, options) {
        const path = new URL(url).pathname;
        expect(path.startsWith(hydroDomainPrefix("student"))).toBe(true);
        if (options?.method === "POST") {
          expect(path).toBe("/d/student/login");
          expect(new URLSearchParams(options.body).get("redirect")).toBe(
            `${origin}/d/student/`,
          );
          loggedIn = true;
          logins += 1;
          return response(`${origin}/d/student/`, home());
        }
        if (!loggedIn)
          return response(url, '<html data-page="user_login"></html>');
        if (path === "/d/student/") return response(url, home());
        if (path.endsWith("/user/42")) return response(url, '{"tdocs":[]}');
        if (expireList) {
          expireList = false;
          loggedIn = false;
          return response(
            `${origin}/d/student/login`,
            '<html data-page="user_login"></html>',
          );
        }
        return response(url, '{"page":1,"rdocs":[]}');
      },
    };
    const request = input(http);
    request.account.authMode = "password";
    request.credentials = { username: "tester", password: "test-only" };
    expect((await hydroOJAdapter.authorize(request)).providerAccountKey).toBe(
      "42",
    );
    expect(
      (await hydroOJAdapter.fetchRecent(request)).coverage.outcome.status,
    ).toBe("complete");
    expect(logins).toBe(2);
  });

  it("serializes different-domain password accounts on the website session lock", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const logins: string[] = [];
    const http: HttpClient = {
      async request(_source, url, options) {
        const domain = new URL(url).pathname.split("/")[2]!;
        if (options?.method === "POST") {
          logins.push(domain);
          if (domain === "student") {
            started();
            await gate;
          }
          expect(new URLSearchParams(options.body).get("redirect")).toBe(
            `${origin}/d/${domain}/`,
          );
          return response(
            `${origin}/d/${domain}/`,
            home(domain === "student" ? 42 : 43, domain),
          );
        }
        return response(url, home(domain === "student" ? 42 : 43, domain));
      },
    };
    const student = input(http);
    student.account.authMode = "password";
    student.credentials = { username: "student-user", password: "test-only" };
    const teacher = {
      ...student,
      account: {
        ...student.account,
        domainId: "teacher",
        accountId: "teacher-account",
        providerAccountKey: "43",
      },
    };
    const first = hydroOJAdapter.authorize(student);
    await firstStarted;
    const second = hydroOJAdapter.authorize(teacher);
    await Promise.resolve();
    expect(logins).toEqual(["student"]);
    release();
    const authorized = await Promise.all([first, second]);
    expect(logins).toEqual(["student", "teacher"]);
    expect(authorized.map((account) => account.providerAccountKey)).toEqual([
      "42",
      "43",
    ]);
  });
});
