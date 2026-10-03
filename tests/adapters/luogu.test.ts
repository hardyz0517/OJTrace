import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeLuoguRecord } from "../../src/adapters/luogu/normalizer";
import { luoguAdapter } from "../../src/adapters/luogu";
import {
  parseLuoguDocument,
  parseLuoguIdentityDocument,
  parseLuoguResponse,
} from "../../src/adapters/luogu/parser";

describe("Luogu parser and normalizer", () => {
  const fixture = (name: string) =>
    readFileSync(
      new URL(`../../docs/fixtures/luogu/${name}`, import.meta.url),
      "utf8",
    );

  it("exposes browser session first with a manual cookie fallback", () => {
    expect(luoguAdapter.metadata.authModes).toEqual([
      expect.objectContaining({ type: "browser-session", recommended: true }),
      expect.objectContaining({ type: "manual-cookie" }),
    ]);
  });

  it("declares the two named Luogu cookies instead of one ambiguous field", () => {
    const fields = luoguAdapter.metadata.authModes.find(
      (mode) => mode.type === "manual-cookie",
    )?.credentialFields;
    expect(fields).toEqual([
      expect.objectContaining({
        key: "__client_id",
        credentialType: "cookie",
        required: true,
      }),
      expect.objectContaining({
        key: "_uid",
        credentialType: "cookie",
        required: true,
      }),
    ]);
  });

  it("detects the current browser session without returning credentials", async () => {
    const result = await luoguAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http: {
        async request() {
          return {
            status: 200,
            url: "https://www.luogu.com.cn/user/setting?_contentOnly=1",
            contentType: "application/json",
            text: JSON.stringify({ user: { uid: 7, name: "tester" } }),
            headers: new Headers(),
          };
        },
      },
    });
    expect(result).toEqual({
      authenticated: true,
      status: "authenticated",
      uid: "7",
      username: "tester",
    });
  });

  it("accepts a full manual cookie without requiring a UID", async () => {
    let options: Record<string, unknown> | undefined;
    const result = await luoguAdapter.fetchRecent({
      account: {
        accountId: "account",
        source: "luogu",
        identifier: "",
        enabled: true,
        authMode: "manual-cookie",
      },
      credentials: { __client_id: "redacted", _uid: "99" },
      limit: 10,
      signal: new AbortController().signal,
      now: 1_700_000_001_000,
      requestId: "request",
      http: {
        async request(_source, _url, requestOptions) {
          options = requestOptions as Record<string, unknown>;
          return {
            status: 200,
            url: "https://www.luogu.com.cn/record/list",
            contentType: "application/json",
            text: JSON.stringify({
              currentData: {
                user: { uid: 99, name: "tester" },
                records: { result: [] },
              },
            }),
            headers: new Headers(),
          };
        },
      },
    });
    expect(result.account.providerAccountKey).toBe("99");
    expect(options).toMatchObject({
      credentials: "omit",
      headers: { Cookie: "__client_id=redacted; _uid=99" },
    });
  });

  it("reads language and metrics from a detail payload when the list is sparse", () => {
    const item = normalizeLuoguRecord(
      {
        id: 16,
        submitTime: 1_700_000_000,
        status: 12,
        submission: {
          language: 11,
          time: { value: 80 },
          memory: { value: 835_584 },
          codeLength: 292,
        },
        problem: { pid: "P1006" },
      },
      "account",
      "99",
      1_700_000_001_000,
    );
    expect(item.language).toBe("C++14");
    expect(item.timeMs).toBe(80);
    expect(item.memoryKb).toBe(835_584);
    expect(item.codeLength).toBe(292);
  });

  it("parses the documented JSON-shaped fixture", () => {
    const records = parseLuoguResponse(
      JSON.stringify({
        currentData: {
          records: {
            result: [
              {
                id: 10,
                submitTime: 1_700_000_000,
                status: "AC",
                problem: { pid: "P1001", title: "A+B" },
              },
            ],
          },
        },
      }),
    );
    const item = normalizeLuoguRecord(
      records[0]!,
      "account",
      "123",
      1_700_000_001_000,
    );
    expect(item.submissionId).toBe("10");
    expect(item.problemId).toBe("P1001");
    expect(item.verdict.code).toBe("accepted");
    expect(item.submittedAt).toBe(1_700_000_000_000);
    expect(item.submissionUrl).toBe("https://www.luogu.com.cn/record/10");
  });

  it("normalizes the live DataResponse shape and numeric verdicts", () => {
    const parsed = parseLuoguDocument(
      JSON.stringify({
        code: 200,
        currentUser: { uid: 99, name: "tester" },
        currentData: {
          user: { uid: 99, name: "tester" },
          records: {
            result: [
              {
                id: 11,
                submitTime: 1_700_000_000,
                status: 12,
                language: 11,
                time: { value: 80 },
                memory: { value: 835_584 },
                codeLength: 292,
                problem: { pid: "P1001", title: "A+B" },
              },
              {
                id: 12,
                submitTime: 1_700_000_001,
                status: { status: 6 },
                problem: "P1002",
              },
            ],
            count: 2,
            perPage: 20,
          },
        },
      }),
    );
    expect(parsed.user?.uid).toBe(99);
    expect(parsed.currentUser?.name).toBe("tester");
    expect(parsed.count).toBe(2);
    expect(parsed.perPage).toBe(20);
    const accepted = normalizeLuoguRecord(
      parsed.records[0]!,
      "account",
      "99",
      1_700_000_001_000,
    );
    const wrong = normalizeLuoguRecord(
      parsed.records[1]!,
      "account",
      "99",
      1_700_000_001_000,
    );
    expect(accepted.verdict.code).toBe("accepted");
    expect(accepted.language).toBe("C++14");
    expect(accepted.timeMs).toBe(80);
    expect(accepted.memoryKb).toBe(835_584);
    expect(accepted.codeLength).toBe(292);
    expect(wrong.verdict.code).toBe("wrong_answer");
    expect(wrong.problemId).toBe("P1002");
  });

  it("keeps the problem name when Luogu returns problem.name", () => {
    const item = normalizeLuoguRecord(
      {
        id: 13,
        submitTime: 1_700_000_000,
        status: 12,
        problem: { pid: "P1003", name: "数字反转" },
      },
      "account",
      "99",
      1_700_000_001_000,
    );
    expect(item.problemName).toBe("数字反转");
  });

  it("accepts the flat problemName field from record responses", () => {
    const item = normalizeLuoguRecord(
      {
        id: 14,
        submitTime: 1_700_000_000,
        status: 12,
        pid: "P1004",
        problemName: "守卫者的挑战",
      },
      "account",
      "99",
      1_700_000_001_000,
    );
    expect(item.problemName).toBe("守卫者的挑战");
  });

  it("accepts the current nested problem content name", () => {
    const item = normalizeLuoguRecord(
      {
        id: 15,
        submitTime: 1_700_000_000,
        status: 12,
        problem: {
          pid: "P1005",
          content: { name: "矩阵取数游戏" },
        },
      },
      "account",
      "99",
      1_700_000_001_000,
    );
    expect(item.problemName).toBe("矩阵取数游戏");
  });

  it("extracts names and problem URLs from the authenticated record HTML", () => {
    const parsed = parseLuoguDocument(
      '<html><body><div><a href="/record/299590642">AC</a><a href="/problem/P6927">P6927 [ICPC 2016 WF] Swap Space</a></div></body></html>',
      "text/html",
    );
    expect(parsed.records).toEqual([
      expect.objectContaining({
        id: "299590642",
        problem: { pid: "P6927", title: "P6927 [ICPC 2016 WF] Swap Space" },
        problemUrl: "https://www.luogu.com.cn/problem/P6927",
      }),
    ]);
  });

  it("extracts the logged-in identity from the setting response", () => {
    const identity = parseLuoguIdentityDocument(
      JSON.stringify({
        instance: "main",
        status: 200,
        data: { setting: { openSource: true } },
        user: { uid: 123456, name: "tester" },
      }),
    );
    expect(identity).toEqual({ uid: 123456, name: "tester" });
  });

  it("rejects login HTML instead of treating it as empty", () => {
    expect(() =>
      parseLuoguResponse("<!doctype html><html><body>Login</body></html>"),
    ).toThrow("login page");
  });

  it("parses successful lentille-context HTML instead of treating it as login", () => {
    const parsed = parseLuoguDocument(
      '<!doctype html><html><body><script id="lentille-context" type="application/json">{"template":"record.list","status":200,"data":{"user":{"uid":7,"name":"tester"},"records":{"result":[]}}}</script></body></html>',
    );
    expect(parsed.records).toHaveLength(0);
    expect(parsed.user?.uid).toBe(7);
  });

  it("parses record names from Luogu's encoded page payload", () => {
    const payload = encodeURIComponent(
      JSON.stringify({
        currentData: {
          records: {
            result: [
              {
                id: 88,
                submitTime: 1_700_000_000,
                status: 12,
                problem: { pid: "P6927", title: "[ICPC 2016 WF] Swap Space" },
              },
            ],
          },
        },
      }),
    );
    const parsed = parseLuoguDocument(
      `<script>JSON.parse(decodeURIComponent("${payload}"))</script>`,
      "text/html",
    );
    expect(parsed.records[0]?.problem).toEqual({
      pid: "P6927",
      title: "[ICPC 2016 WF] Swap Space",
    });
  });

  it("keeps the checked-in Luogu response fixtures executable", () => {
    expect(parseLuoguDocument(fixture("ok-json.json")).records).toHaveLength(0);
    expect(parseLuoguDocument(fixture("ok-html.html")).records).toHaveLength(0);
    expect(parseLuoguDocument(fixture("empty.json")).records).toHaveLength(0);
    expect(() => parseLuoguDocument(fixture("login-html.html"))).toThrow(
      "login page",
    );
  });

  it("keeps authentication failures in the background without opening a page", async () => {
    let requestCalls = 0;
    await expect(
      luoguAdapter.fetchRecent({
        account: {
          accountId: "account",
          source: "luogu",
          identifier: "99",
          enabled: true,
          authMode: "browser-session",
        },
        limit: 100,
        signal: new AbortController().signal,
        now: 1_700_000_001_000,
        requestId: "request",
        http: {
          async request() {
            requestCalls += 1;
            return {
              status: 401,
              url: "https://www.luogu.com.cn/record/list",
              contentType: "application/json",
              text: JSON.stringify({ errorCode: 401 }),
              headers: new Headers(),
            };
          },
        },
      }),
    ).rejects.toMatchObject({ error: { kind: "auth_required" } });
    expect(requestCalls).toBe(1);
  });

  it("recognizes a login error embedded in a successful HTTP response", async () => {
    await expect(
      luoguAdapter.fetchRecent({
        account: {
          accountId: "account",
          source: "luogu",
          identifier: "99",
          enabled: true,
          authMode: "browser-session",
        },
        limit: 100,
        signal: new AbortController().signal,
        now: 1_700_000_001_000,
        requestId: "request",
        http: {
          async request() {
            return {
              status: 200,
              url: "https://www.luogu.com.cn/record/list",
              contentType: "application/json",
              text: JSON.stringify({
                errorCode: 401,
                errorType: "UserUnloginException",
              }),
              headers: new Headers(),
            };
          },
        },
      }),
    ).rejects.toMatchObject({ error: { kind: "auth_required" } });
  });

  it("maps HTTP 429 to a source rate-limit error", async () => {
    await expect(
      luoguAdapter.fetchRecent({
        account: {
          accountId: "account",
          source: "luogu",
          identifier: "99",
          enabled: true,
          authMode: "browser-session",
        },
        limit: 100,
        signal: new AbortController().signal,
        now: 1_700_000_001_000,
        requestId: "request",
        http: {
          async request() {
            return {
              status: 429,
              url: "https://www.luogu.com.cn/record/list",
              contentType: "application/json",
              text: JSON.stringify({ errorCode: 429 }),
              headers: new Headers(),
            };
          },
        },
      }),
    ).rejects.toMatchObject({ error: { kind: "rate_limited" } });
  });

  it("continues through record pages until the requested time window is covered", async () => {
    const requests: string[] = [];
    const page = (id: number, submitTime: number) =>
      JSON.stringify({
        data: {
          user: { uid: 123456, name: "tester" },
          records: {
            count: 2,
            result: [
              {
                id,
                submitTime,
                status: 12,
                problem: { pid: `P${id}`, title: `Problem ${id}` },
              },
            ],
          },
        },
      });
    const http = {
      async request(_source: string, url: string) {
        requests.push(url);
        const isFirstPage = url.includes("page=1");
        return {
          status: 200,
          url,
          contentType: "application/json",
          text: isFirstPage ? page(2, 1_700_000_000) : page(1, 1_699_000_000),
          headers: new Headers(),
        };
      },
    };
    const result = await luoguAdapter.fetchRecent({
      account: {
        accountId: "account",
        source: "luogu",
        identifier: "123456",
        enabled: true,
        authMode: "browser-session",
      },
      limit: 1_000,
      since: 1_699_500_000_000,
      signal: new AbortController().signal,
      now: 1_700_000_001_000,
      requestId: "request",
      http,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain("page=2");
    expect(result.records.map((record) => record.submissionId)).toEqual(["2"]);
  });

  it("can discover the current account when the identifier is blank", async () => {
    const responses = new Map([
      [
        "https://www.luogu.com.cn/user/setting?_contentOnly=1",
        JSON.stringify({
          instance: "main",
          status: 200,
          data: { setting: {} },
          user: { uid: 123456, name: "tester" },
        }),
      ],
      [
        "https://www.luogu.com.cn/record/list?user=123456&page=1&_contentOnly=1",
        JSON.stringify({
          code: 200,
          currentData: {
            user: { uid: 123456, name: "tester" },
            records: {
              result: [
                {
                  id: 77,
                  submitTime: 1_700_000_000,
                  status: 12,
                  problem: { pid: "P1001", title: "A+B" },
                },
              ],
            },
          },
        }),
      ],
    ]);
    const result = await luoguAdapter.fetchRecent({
      account: {
        accountId: "account",
        source: "luogu",
        identifier: "",
        enabled: true,
        authMode: "browser-session",
      },
      limit: 100,
      signal: new AbortController().signal,
      now: 1_700_000_001_000,
      requestId: "request",
      http: {
        async request(_source, url) {
          return {
            status: 200,
            url,
            contentType: "application/json",
            text: responses.get(url)!,
            headers: new Headers(),
          };
        },
      },
    });
    expect(result.account.providerAccountKey).toBe("123456");
    expect(result.records[0]?.submissionId).toBe("77");
  });
});
