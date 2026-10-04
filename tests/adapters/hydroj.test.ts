import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../src/domain";
import { AdapterFailure } from "../../src/domain/errors";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import {
  createHydroOJInstance,
  hydroOJRecordsUrl,
  hydroOJUserUrl,
  HYDROOJ_OFFICIAL_ORIGIN,
} from "../../src/adapters/hydroj/instance";
import { normalizeHydroOJSubmission } from "../../src/adapters/hydroj/normalizer";
import { parseHydroOJRecordPage } from "../../src/adapters/hydroj/parser";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../docs/fixtures/hydroj/${name}`, import.meta.url),
    "utf8",
  );

describe("HydroOJ research utilities", () => {
  it("exposes browser, cookie, and password login modes", () => {
    expect(hydroOJAdapter.metadata.authModes.map((mode) => mode.type)).toEqual([
      "browser-session",
      "manual-cookie",
      "password",
    ]);
    expect(
      hydroOJAdapter.metadata.authModes.find(
        (mode) => mode.type === "password",
      ),
    ).toMatchObject({
      identifierRequired: false,
      credentialFields: [
        { key: "username", type: "text" },
        { key: "password", type: "password" },
      ],
    });
  });

  it("defaults to the official candidate and normalizes custom instances", () => {
    expect(createHydroOJInstance()).toEqual({
      origin: HYDROOJ_OFFICIAL_ORIGIN,
      kind: "official",
    });
    expect(createHydroOJInstance("https://oj.example.org/")).toEqual({
      origin: "https://oj.example.org",
      kind: "custom",
    });
  });

  it("rejects unsafe or ambiguous instance origins", () => {
    for (const origin of [
      "http://oj.example.org",
      "https://user:pass@oj.example.org",
      "https://oj.example.org/path",
      "https://localhost",
      "https://192.168.1.2",
    ]) {
      if (origin.startsWith("http:")) {
        expect(createHydroOJInstance(origin).origin).toBe(origin);
      } else {
        expect(() => createHydroOJInstance(origin)).toThrow();
      }
    }
  });

  it("builds candidate routes with encoded input and bounds pagination", () => {
    expect(hydroOJRecordsUrl("https://oj.example.org", "a b", 2)).toBe(
      "https://oj.example.org/record?uidOrName=a+b&page=2",
    );
    expect(hydroOJUserUrl("https://oj.example.org", "42")).toBe(
      "https://oj.example.org/user/42",
    );
    expect(() => hydroOJRecordsUrl("https://oj.example.org", "a", 0)).toThrow();
    expect(() => hydroOJUserUrl("https://oj.example.org", "alice")).toThrow();
  });

  it("parses only the explicit record-page JSON shape and normalizes model candidates", () => {
    const page = parseHydroOJRecordPage(fixture("record-page-contract.json"));
    expect(page.page).toBe(1);
    const record = normalizeHydroOJSubmission(page.rdocs[0]!);
    expect(record).toMatchObject({
      submissionId: "000000000000000000000001",
      submittedAt: Date.parse("2026-01-01T00:00:00.000Z"),
      verdict: { code: "accepted", raw: "1" },
    });
  });

  it("enriches JSON records from Hydro's pdict and keeps activity links", () => {
    const page = parseHydroOJRecordPage(
      JSON.stringify({
        page: 1,
        rdocs: [{ _id: "6831d68a5546fddf447ad313", pid: 1382, status: 1 }],
        pdict: {
          "1382": { docId: 1382, title: "WL22 T3 闯关游戏" },
        },
      }),
      "http://hydro.example.org/record?uidOrName=1100&page=1&tid=6940ba67fb0f033a69e00504",
    );
    expect(page.rdocs[0]).toMatchObject({
      pid: 1382,
      problemName: "WL22 T3 闯关游戏",
      problemUrl: "/p/1382?tid=6940ba67fb0f033a69e00504",
      submissionUrl: "/record/6831d68a5546fddf447ad313",
    });
  });

  it("normalizes HTML statuses that include a score before the label", () => {
    const page = parseHydroOJRecordPage(`
      <html data-page="record_main"><tr data-rid="6831d6555546fddf447ad2d9">
        <td class="col--status"><a class="record-status--text"><span>0</span> Compile Error</a></td>
        <td class="col--problem"><a href="/p/1"><b>1</b> Card</a></td>
        <td class="col--time">0ms</td><td class="col--memory">0 KiB</td>
        <td class="col--lang">C++20</td><td data-timestamp="1748096597"></td>
      </tr></html>
    `);
    expect(normalizeHydroOJSubmission(page.rdocs[0]!)).toMatchObject({
      verdict: { code: "compilation_error", raw: "Compile Error" },
      score: 0,
    });
  });

  it("uses Hydro's current status codes and resolves language display names", () => {
    expect(
      normalizeHydroOJSubmission({
        _id: "6831d6555546fddf447ad2d9",
        pid: "P1130",
        status: 7,
        lang: "cc.cc20o2",
        submitAt: "2026-01-02T00:00:00Z",
      }),
    ).toMatchObject({
      verdict: { code: "compilation_error", raw: "7" },
      language: "C++20(O2)",
    });
    expect(
      normalizeHydroOJSubmission({
        _id: "6831d6555546fddf447ad2da",
        status: 5,
        submitAt: "2026-01-02T00:00:00Z",
      }).verdict.code,
    ).toBe("rejected");
  });

  it.each([
    ["764 KiB", 764],
    ["1.5 MiB", 1536],
    ["1024 B", 1],
    ["-", undefined],
  ])("converts HTML memory %s to KiB", (memory, expected) => {
    const page = parseHydroOJRecordPage(
      `<html data-page="record_main"><tr data-rid="6831d6555546fddf447ad2d9"><td class="col--memory">${memory}</td></tr></html>`,
    );
    expect(normalizeHydroOJSubmission(page.rdocs[0]!).memoryKb).toBe(expected);
  });

  it("uses submission time rather than rejudge time", () => {
    const raw = {
      _id: "6831d68a5546fddf447ad313",
      status: 1,
      judgeAt: "2026-01-01T00:00:00Z",
    };
    const timestamp = parseInt(raw._id.slice(0, 8), 16) * 1000;
    expect(normalizeHydroOJSubmission(raw).submittedAt).toBe(timestamp);
    expect(
      normalizeHydroOJSubmission({ ...raw, submitAt: 1748096600 }).submittedAt,
    ).toBe(1748096600000);
  });

  it("never treats challenge HTML or an unknown body as an empty page", () => {
    expect(() => parseHydroOJRecordPage(fixture("challenge.html"))).toThrow();
    expect(() => parseHydroOJRecordPage('{"page":1,"rdocs":[]}')).not.toThrow();
  });

  it("rejects malformed data instead of silently normalizing it", () => {
    expect(() => parseHydroOJRecordPage('{"page":0,"rdocs":[]}')).toThrow();
    expect(() => normalizeHydroOJSubmission({ _id: "id", status: 1 })).toThrow(
      "HydroOJ record has no stable id",
    );
  });

  it("logs in again when a password account receives the login page", async () => {
    const loginPage = '<html data-page="user_login"><title>登录</title></html>';
    const loginHome =
      '<script>window.UserContext = \'{"_id":42,"uname":"test-user"}\';</script>';
    const requests: Array<{
      url: string;
      options?: Parameters<HttpClient["request"]>[2];
    }> = [];
    const http: HttpClient = {
      request: vi.fn(async (source, url, options) => {
        expect(source).toBe("hydroj");
        requests.push({ url, options });
        if (requests.length === 1) {
          return {
            status: 200,
            url,
            contentType: "text/html",
            text: loginPage,
            headers: new Headers(),
          };
        }
        if (requests.length === 2) {
          return {
            status: 200,
            url,
            contentType: "text/html",
            text: loginHome,
            headers: new Headers(),
          };
        }
        return {
          status: 200,
          url,
          contentType: "application/json",
          text: url.includes("page=2")
            ? '{"page":2,"rdocs":[]}'
            : url.includes("/user/")
              ? '{"tdocs":[]}'
              : fixture("record-page-contract.json"),
          headers: new Headers(),
        };
      }),
    };

    const result = await hydroOJAdapter.fetchRecent({
      account: {
        accountId: "account-1",
        source: "hydroj",
        identifier: "",
        enabled: true,
        authMode: "password",
        origin: "http://hydro.example.org",
      },
      credentials: { username: "test-user", password: "test-password" },
      limit: 100,
      since: 0,
      until: Date.now(),
      pagination: { runPage: ({ request }) => request() },
      signal: new AbortController().signal,
      now: Date.now(),
      requestId: "request-1",
      http,
    });

    expect(requests).toHaveLength(5);
    expect(requests[1]?.options).toMatchObject({
      method: "POST",
      credentials: "include",
      followRedirects: true,
    });
    expect(requests[1]?.options?.body).toContain("uname=test-user");
    expect(requests[1]?.options?.body).toContain("password=test-password");
    expect(requests[2]?.url).toContain("uidOrName=42");
    expect(requests[4]?.url).toContain("/user/42");
    expect(result.account).toMatchObject({
      providerAccountKey: "42",
      displayName: "test-user",
    });
    expect(result.records).toHaveLength(1);
  });

  it("continues JSON pages until a verified tail when explicit timestamps lack an ordering contract", async () => {
    const requests: string[] = [];
    const page = (number: number, judgeAt: string) =>
      JSON.stringify({
        page: number,
        rdocs: [
          {
            _id: `00000000000000000000000${number}`,
            uid: 42,
            pid: `P${number}`,
            status: 1,
            submitAt: judgeAt,
          },
        ],
      });
    const result = await hydroOJAdapter.fetchRecent({
      account: {
        accountId: "account-1",
        source: "hydroj",
        identifier: "tester",
        enabled: true,
        authMode: "browser-session",
        origin: "http://hydro.example.org",
      },
      limit: 1_000,
      since: Date.parse("2026-01-01T00:00:00.000Z"),
      until: Date.parse("2026-01-03T00:00:00.000Z"),
      pagination: { runPage: ({ request }) => request() },
      signal: new AbortController().signal,
      now: Date.parse("2026-01-03T00:00:00.000Z"),
      requestId: "request-3",
      http: {
        async request(_source, url) {
          requests.push(url);
          if (new URL(url).pathname === "/")
            return {
              status: 200,
              url,
              contentType: "text/html",
              text: `<script>window.UserContext = '{"_id":42,"uname":"tester"}';</script>`,
              headers: new Headers(),
            };
          if (url.includes("/user/"))
            return {
              status: 200,
              url,
              contentType: "application/json",
              text: '{"tdocs":[]}',
              headers: new Headers(),
            };
          return {
            status: 200,
            url,
            contentType: "application/json",
            text: url.includes("page=3")
              ? '{"page":3,"rdocs":[]}'
              : url.includes("page=2")
                ? page(2, "2025-12-31T00:00:00.000Z")
                : page(1, "2026-01-02T00:00:00.000Z"),
            headers: new Headers(),
          };
        },
      },
    });

    expect(requests).toHaveLength(5);
    expect(requests[2]).toContain("page=2");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.problemId).toBe("P1");
  });

  it("reports a clear error when password login is rejected", async () => {
    const loginPage = '<html data-page="user_login"><title>登录</title></html>';
    const http: HttpClient = {
      request: vi.fn(async (_source, url) => ({
        status: 200,
        url,
        contentType: "text/html",
        text: loginPage,
        headers: new Headers(),
      })),
    };

    let failure: unknown;
    try {
      await hydroOJAdapter.fetchRecent({
        account: {
          accountId: "account-1",
          source: "hydroj",
          identifier: "",
          enabled: true,
          authMode: "password",
          origin: "http://hydro.example.org",
        },
        credentials: { username: "test-user", password: "test-password" },
        limit: 100,
        since: 0,
        until: Date.now(),
        pagination: { runPage: ({ request }) => request() },
        signal: new AbortController().signal,
        now: Date.now(),
        requestId: "request-2",
        http,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AdapterFailure);
    expect((failure as AdapterFailure).error.messageKey).toBe(
      "source.loginFailed",
    );
  });
});
