import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCrossOjSubmitMessage } from "../../src/oj-enhancer/features/cross-oj-submit/background-bridge";
import {
  isAuthorizedLuoguRecordDetailPage,
  isAuthorizedLuoguRecordListPage,
} from "../../src/oj-enhancer/features/cross-oj-submit/record-list-authorization";
import type {
  AtCoderProblemRef,
  ProblemRef,
} from "../../src/oj-enhancer/features/cross-oj-submit/model";

const codeforcesProblem: ProblemRef = {
  oj: "codeforces",
  contestId: "1",
  index: "A",
  source: "luogu-pid",
};

const atcoderProblem: AtCoderProblemRef = {
  oj: "atcoder",
  contestId: "abc175",
  taskId: "abc175_f",
  source: "luogu-origin-link",
  originUrl: "https://atcoder.jp/contests/abc175/tasks/abc175_f",
};

const codeforcesRoute = {
  oj: "codeforces" as const,
  contestId: "1",
  submissionId: "397475296",
  problemId: "CF1A",
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "browser");
});

describe("Luogu cross-OJ record-list authorization", () => {
  it("accepts Codeforces record-list URLs when only non-problem filters change", () => {
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/record/list?pid=CF1A&user=981551&page=1",
        "https://www.luogu.com.cn/record/list?pid=CF1A&user=981551&page=2#result",
        codeforcesProblem,
      ),
    ).toBe(true);
  });

  it("authorizes AtCoder records from the Luogu pid without page-context injection", () => {
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/record/list?pid=AT_abc175_f",
        "https://www.luogu.com.cn/record/list?pid=AT_abc175_f",
        atcoderProblem,
      ),
    ).toBe(true);
  });

  it("authorizes the first SPA navigation when sender.url still points at the problem page", () => {
    const listUrl = "https://www.luogu.com.cn/record/list?pid=CF1A&user=981551";
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/problem/CF1A",
        listUrl,
        codeforcesProblem,
      ),
    ).toBe(true);
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/problem/CF1A",
        "https://www.luogu.com.cn/problem/CF1A",
        codeforcesProblem,
        listUrl,
      ),
    ).toBe(true);
    expect(
      isAuthorizedLuoguRecordDetailPage(
        "https://www.luogu.com.cn/record/list?pid=CF1A",
        "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/397475296",
        codeforcesRoute,
      ),
    ).toBe(true);
    expect(
      isAuthorizedLuoguRecordDetailPage(
        "https://www.luogu.com.cn/record/list?pid=CF1A",
        "https://www.luogu.com.cn/record/list?pid=CF1A",
        codeforcesRoute,
        "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/397475296",
      ),
    ).toBe(true);
  });

  it("rejects a stale sender URL after the tab changes to another problem", () => {
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/record/list?pid=CF1A",
        "https://www.luogu.com.cn/record/list?pid=CF1B",
        codeforcesProblem,
      ),
    ).toBe(false);
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/problem/CF1A",
        "https://www.luogu.com.cn/record/list?pid=CF1B",
        codeforcesProblem,
        "https://www.luogu.com.cn/record/list?pid=CF1A",
      ),
    ).toBe(false);
  });

  it("rejects non-record routes, ambiguous pids, and mismatched problem identities", () => {
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/problem/CF1A",
        "https://www.luogu.com.cn/problem/CF1A",
        codeforcesProblem,
      ),
    ).toBe(false);
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/record/list?pid=CF1A&pid=CF1A",
        "https://www.luogu.com.cn/record/list?pid=CF1A",
        codeforcesProblem,
      ),
    ).toBe(true);
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/record/list?pid=CF1A",
        "https://www.luogu.com.cn/record/list?pid=CF1A&pid=CF1A",
        codeforcesProblem,
      ),
    ).toBe(false);
    expect(
      isAuthorizedLuoguRecordListPage(
        "https://www.luogu.com.cn/record/list?pid=CF1B",
        "https://www.luogu.com.cn/record/list?pid=CF1B",
        codeforcesProblem,
      ),
    ).toBe(false);
  });

  it("loads both record lists without injecting code into the Luogu page", async () => {
    const executeScript = vi.fn(async () => {
      throw new Error("The record list should not execute page code.");
    });
    let pageUrl = "https://www.luogu.com.cn/record/list?pid=CF1A&user=981551";
    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: {
        runtime: { id: "ojtrace-test" },
        tabs: { get: async () => ({ id: 7, url: pageUrl }) },
        scripting: { executeScript },
        storage: {
          local: { get: async () => ({}) },
          session: { get: async () => ({}) },
        },
      },
    });

    for (const problem of [codeforcesProblem, atcoderProblem]) {
      pageUrl = `https://www.luogu.com.cn/record/list?pid=${problem.oj === "atcoder" ? "AT_abc175_f" : "CF1A"}&user=981551`;
      const response = await handleCrossOjSubmitMessage(
        {
          schemaVersion: 1,
          requestId: `request-${problem.oj}`,
          type: "GET_CROSS_OJ_RECORDS",
          problem,
        },
        {
          id: "ojtrace-test",
          url: pageUrl,
          frameId: 0,
          tab: { id: 7 },
        },
      );
      expect(response?.ok).toBe(true);
    }

    expect(executeScript).not.toHaveBeenCalled();
  });

  it("loads the first SPA record-list visit from a stale isolated-world sender URL", async () => {
    const executeScript = vi.fn(async () => {
      throw new Error("The record list should not execute page code.");
    });
    const listUrl = "https://www.luogu.com.cn/record/list?pid=CF1A&user=981551";
    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: {
        runtime: { id: "ojtrace-test" },
        tabs: { get: async () => ({ id: 7, url: listUrl }) },
        scripting: { executeScript },
        storage: {
          local: { get: async () => ({}) },
          session: { get: async () => ({}) },
        },
      },
    });

    const staleSender = {
      id: "ojtrace-test",
      url: "https://www.luogu.com.cn/problem/CF1A",
      frameId: 0,
      tab: { id: 7 },
    };
    const updatedTab = await handleCrossOjSubmitMessage(
      {
        schemaVersion: 1,
        requestId: "spa-first-open",
        type: "GET_CROSS_OJ_RECORDS",
        problem: codeforcesProblem,
        pageUrl: listUrl,
      },
      staleSender,
    );
    expect(updatedTab).toMatchObject({
      ok: true,
      code: "records-loaded",
    });

    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: {
        runtime: { id: "ojtrace-test" },
        tabs: {
          get: async () => ({
            id: 7,
            url: "https://www.luogu.com.cn/problem/CF1A",
          }),
        },
        scripting: { executeScript },
        storage: {
          local: { get: async () => ({}) },
          session: { get: async () => ({}) },
        },
      },
    });
    const pendingTab = await handleCrossOjSubmitMessage(
      {
        schemaVersion: 1,
        requestId: "spa-first-open-pending-tab",
        type: "GET_CROSS_OJ_RECORDS",
        problem: codeforcesProblem,
        pageUrl: listUrl,
      },
      staleSender,
    );
    expect(pendingTab).toMatchObject({
      ok: true,
      code: "records-loaded",
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("loads a native record detail after SPA navigation from the list page", async () => {
    const detailUrl =
      "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/397475296";
    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: {
        runtime: { id: "ojtrace-test" },
        tabs: { get: async () => ({ id: 7, url: detailUrl }) },
        storage: {
          local: {
            get: async () => ({
              "ojtrace:cross-oj-submit:history": [
                {
                  oj: "codeforces",
                  submissionId: "397475296",
                  problemId: "1/A",
                  detailUrl:
                    "https://codeforces.com/contest/1/submission/397475296",
                  observedAt: 1,
                  evaluationStatus: "accepted",
                  statusUpdatedAt: 1,
                },
              ],
            }),
          },
          session: { get: async () => ({}) },
        },
      },
    });

    const response = await handleCrossOjSubmitMessage(
      {
        schemaVersion: 1,
        requestId: "spa-detail",
        type: "GET_CROSS_OJ_DETAIL",
        submissionId: "397475296",
        oj: "codeforces",
        pageUrl: detailUrl,
      },
      {
        id: "ojtrace-test",
        url: "https://www.luogu.com.cn/record/list?pid=CF1A",
        frameId: 0,
        tab: { id: 7 },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      code: "record-detail-loaded",
      detail: { submissionId: "397475296" },
    });

    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: {
        runtime: { id: "ojtrace-test" },
        tabs: {
          get: async () => ({
            id: 7,
            url: "https://www.luogu.com.cn/record/list?pid=CF1A",
          }),
        },
        storage: {
          local: {
            get: async () => ({
              "ojtrace:cross-oj-submit:history": [
                {
                  oj: "codeforces",
                  submissionId: "397475296",
                  problemId: "1/A",
                  detailUrl:
                    "https://codeforces.com/contest/1/submission/397475296",
                  observedAt: 1,
                  evaluationStatus: "accepted",
                  statusUpdatedAt: 1,
                },
              ],
            }),
          },
          session: { get: async () => ({}) },
        },
      },
    });
    const pendingTab = await handleCrossOjSubmitMessage(
      {
        schemaVersion: 1,
        requestId: "spa-detail-pending-tab",
        type: "GET_CROSS_OJ_DETAIL",
        submissionId: "397475296",
        oj: "codeforces",
        pageUrl: detailUrl,
      },
      {
        id: "ojtrace-test",
        url: "https://www.luogu.com.cn/record/list?pid=CF1A",
        frameId: 0,
        tab: { id: 7 },
      },
    );
    expect(pendingTab).toMatchObject({
      ok: true,
      code: "record-detail-loaded",
      detail: { submissionId: "397475296" },
    });
  });
});
