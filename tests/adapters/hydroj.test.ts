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
import {
  assertHydroOJJsonResponse,
  parseHydroOJRecordPage,
} from "../../src/adapters/hydroj/parser";

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

  it("never treats challenge HTML or an unknown body as an empty page", () => {
    expect(() =>
      assertHydroOJJsonResponse("text/html; charset=utf-8"),
    ).toThrow();
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
          text: fixture("record-page-contract.json"),
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
        credentials: { username: "test-user", password: "test-password" },
      },
      limit: 100,
      signal: new AbortController().signal,
      now: Date.now(),
      requestId: "request-1",
      http,
    });

    expect(requests).toHaveLength(3);
    expect(requests[1]?.options).toMatchObject({
      method: "POST",
      credentials: "include",
      followRedirects: true,
    });
    expect(requests[1]?.options?.body).toContain("uname=test-user");
    expect(requests[1]?.options?.body).toContain("password=test-password");
    expect(requests[2]?.url).toContain("uidOrName=test-user");
    expect(result.account).toMatchObject({
      providerAccountKey: "test-user",
      displayName: "test-user",
    });
    expect(result.records).toHaveLength(1);
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
          credentials: { username: "test-user", password: "test-password" },
        },
        limit: 100,
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
