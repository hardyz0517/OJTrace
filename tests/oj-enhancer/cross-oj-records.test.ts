import { describe, expect, it, vi } from "vitest";
import { queryCrossOjRecords } from "../../src/oj-enhancer/features/cross-oj-submit/cross-oj-records";
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
  source: "luogu-pid",
};

function atCoderSubmissionPage(
  items: Array<{
    id: number;
    epochSecond: number;
    taskId: string;
    language?: string;
    score?: number;
    status: string;
    timeMs?: number;
    memoryKiB?: number;
    codeLength?: number;
  }>,
  hasNextPage = false,
): string {
  const rows = items
    .map(
      (item) => `<tr>
        <td class="no-break"><time class="fixtime-second">${new Date(item.epochSecond * 1000).toISOString().slice(0, 19).replace("T", " ")}+0900</time></td>
        <td><a href="/contests/abc175/tasks/${item.taskId}">F - Task</a></td>
        <td><a href="/users/atcoder-user">atcoder-user</a></td>
        <td>${item.language ?? "C++ 17"}</td>
        <td>${item.score ?? 0}</td>
        <td>${item.codeLength ?? 100} Byte</td>
        <td><span class="label label-success">${item.status}</span></td>
        <td>${item.timeMs ?? 1} ms</td>
        <td>${item.memoryKiB ?? 1} KiB</td>
        <td><a href="/contests/abc175/submissions/${item.id}">Detail</a></td>
      </tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Submission Time</th><th>Task</th><th>User</th><th>Language</th><th>Score</th><th>Code Size</th><th>Status</th><th>Exec Time</th><th>Memory</th><th></th></tr></thead><tbody>${rows}</tbody></table><ul class="pager"><li class="${hasNextPage ? "" : "disabled"}"><a>${hasNextPage ? "Next >" : "Next >"}</a></li></ul>`;
}

describe("cross-OJ submission record queries", () => {
  it("reads matching Codeforces records for every enabled account", async () => {
    const requestPage = vi.fn(async (url: string) => {
      const handle = new URL(url).searchParams.get("handle");
      return {
        status: "OK",
        result: [
          {
            id: handle === "alpha" ? 11 : 22,
            creationTimeSeconds: handle === "alpha" ? 100 : 200,
            verdict: handle === "alpha" ? "OK" : "WRONG_ANSWER",
            problem: {
              contestId: 1,
              index: "A",
              name: "Theatre Square",
            },
            programmingLanguage: "GNU C++17",
            timeConsumedMillis: 31,
            memoryConsumedBytes: 86_016,
          },
          {
            id: 33,
            creationTimeSeconds: 300,
            verdict: "OK",
            problem: { contestId: 1, index: "B" },
          },
        ],
      };
    });

    const result = await queryCrossOjRecords({
      handles: ["alpha", "beta", "ALPHA"],
      problem: codeforcesProblem,
      requestPage,
    });

    expect(requestPage).toHaveBeenCalledTimes(2);
    expect(result.records).toHaveLength(2);
    expect(result.records.map((record) => record.submissionId)).toEqual([
      "22",
      "11",
    ]);
    expect(result.records[0]).toMatchObject({
      accountName: "beta",
      evaluationStatus: "rejected",
      problemName: "Theatre Square",
      timeMs: 31,
      memoryBytes: 86_016,
    });
  });

  it("only scans new Codeforces pages and rechecks cached judging submissions", async () => {
    const requestPage = vi.fn(async (url: string) => {
      const from = Number(new URL(url).searchParams.get("from"));
      if (from === 1)
        return {
          status: "OK",
          result: Array.from({ length: 1_000 }, (_, index) => ({
            id: 2_000 - index,
            creationTimeSeconds: 2_000 - index,
            verdict: "OK",
            problem: { contestId: 1, index: "B" },
          })),
        };
      return {
        status: "OK",
        result: [
          {
            id: 100,
            creationTimeSeconds: 100,
            verdict: "OK",
            problem: { contestId: 1, index: "B" },
          },
          {
            id: 49,
            creationTimeSeconds: 49,
            verdict: "OK",
            problem: { contestId: 1, index: "A" },
          },
        ],
      };
    });

    const result = await queryCrossOjRecords({
      handles: ["alpha"],
      problem: codeforcesProblem,
      cursors: { alpha: 100 },
      cachedRecords: [
        {
          oj: "codeforces",
          submissionId: "49",
          problemId: "1/A",
          detailUrl: "https://codeforces.com/contest/1/submission/49",
          observedAt: 49_000,
          statusUpdatedAt: 1,
          evaluationStatus: "judging",
          accountName: "alpha",
        },
      ],
      requestPage,
    });

    expect(requestPage).toHaveBeenCalledTimes(2);
    expect(result.cursors).toEqual({ alpha: 2_000 });
    expect(result.records.map((record) => record.submissionId)).toEqual(["49"]);
    expect(result.records[0]?.evaluationStatus).toBe("accepted");
  });

  it("includes AtCoder practice submissions after the contest and maps their summary", async () => {
    const requestPage = vi.fn(async (_url: string) =>
      atCoderSubmissionPage([
        {
          id: 101,
          epochSecond: 1_000,
          taskId: "abc175_f",
          score: 600,
          status: "AC",
          timeMs: 18,
          memoryKiB: 64,
          codeLength: 1_024,
        },
        {
          id: 102,
          epochSecond: 1_010,
          taskId: "abc175_a",
          score: 100,
          status: "WA",
        },
        {
          id: 103,
          epochSecond: 1_101,
          taskId: "abc175_f",
          score: 0,
          status: "WA",
        },
      ]),
    );

    const result = await queryCrossOjRecords({
      handles: ["atcoder-user"],
      problem: atcoderProblem,
      requestPage,
    });

    expect(new URL(requestPage.mock.calls[0]![0]).origin).toBe(
      "https://atcoder.jp",
    );
    expect(new URL(requestPage.mock.calls[0]![0]).pathname).toBe(
      "/contests/abc175/submissions",
    );
    expect(
      new URL(requestPage.mock.calls[0]![0]).searchParams.get("f.Task"),
    ).toBe("abc175_f");
    expect(
      new URL(requestPage.mock.calls[0]![0]).searchParams.get("f.User"),
    ).toBe("atcoder-user");
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      oj: "atcoder",
      submissionId: "103",
      problemId: "abc175_f",
      evaluationStatus: "rejected",
      score: 0,
      detailUrl: "https://atcoder.jp/contests/abc175/submissions/103",
    });
    expect(result.records[1]).toMatchObject({
      oj: "atcoder",
      submissionId: "101",
      problemId: "abc175_f",
      evaluationStatus: "accepted",
      score: 600,
      timeMs: 18,
      memoryBytes: 64 * 1024,
      codeLength: 1_024,
      detailUrl: "https://atcoder.jp/contests/abc175/submissions/101",
    });
  });

  it("keeps official AtCoder rows whose times include the JST offset", async () => {
    const requestPage = vi.fn(
      async () => `<table class="table table-bordered table-striped table-hover table-condensed">
        <thead>
          <tr>
            <th>Submission Time</th>
            <th>Task</th>
            <th>User</th>
            <th>Language</th>
            <th>Score</th>
            <th>Code Size</th>
            <th>Status</th>
            <th>Exec Time</th>
            <th>Memory</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="no-break"><time class="fixtime-second">2026-11-05 18:52:12+0900</time></td>
            <td><a href="/contests/abc175/tasks/abc175_f">F - Making Palindrome</a></td>
            <td><a href="/users/Hardy_Zheng">Hardy_Zheng</a></td>
            <td>C++ 23 (GCC 15.2.0)</td>
            <td class="text-right">600</td>
            <td class="text-right">1024 Byte</td>
            <td class="text-center"><span class="label label-success" data-toggle="tooltip" data-placement="top" title="Accepted">AC</span></td>
            <td class="text-right">18 ms</td>
            <td class="text-right">64 KiB</td>
            <td class="text-center"><a href="/contests/abc175/submissions/80592532">Detail</a></td>
          </tr>
        </tbody>
      </table>`,
    );

    const result = await queryCrossOjRecords({
      handles: ["Hardy_Zheng"],
      problem: atcoderProblem,
      requestPage,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      oj: "atcoder",
      submissionId: "80592532",
      problemId: "abc175_f",
      evaluationStatus: "accepted",
      score: 600,
      observedAt: Date.parse("2026-11-05T18:52:12+09:00"),
      detailUrl: "https://atcoder.jp/contests/abc175/submissions/80592532",
    });
  });

  it("keeps official AtCoder rows whose user-search title contains an apostrophe", async () => {
    const requestPage = vi.fn(
      async () => `<div class="table-responsive">
        <table class="table table-bordered table-striped small th-center">
          <thead>
            <tr>
              <th width="12%"><a href="/contests/abc175/submissions?desc=true&amp;orderBy=created">Submission Time</a></th>
              <th>Task</th>
              <th>User</th>
              <th>Language</th>
              <th width="5%"><a href="/contests/abc175/submissions?desc=true&amp;orderBy=score">Score</a></th>
              <th width="9%"><a href="/contests/abc175/submissions?orderBy=source_length">Code Size</a></th>
              <th width="5%">Status</th>
              <th width="7%"><a href="/contests/abc175/submissions?orderBy=time_consumption">Exec Time</a></th>
              <th width="8%"><a href="/contests/abc175/submissions?orderBy=memory_consumption">Memory</a></th>
              <th width="5%"></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="no-break"><time class='fixtime fixtime-second'>2026-11-04 16:59:22+0900</time></td>
              <td><a href="/contests/abc175/tasks/abc175_f">F - Making Palindrome</a></td>
              <td><a href="/users/Hardy_Zheng">Hardy_Zheng</a> <a href='/contests/abc175/submissions?f.User=Hardy_Zheng'><span class='glyphicon glyphicon-search black' aria-hidden='true' data-toggle='tooltip' title='view Hardy_Zheng's submissions'></span></a></td>
              <td>C++23 (GCC 15.2.0)</td>
              <td class="text-right submission-score" data-id="80592532">600</td>
              <td class="text-right">527 Byte</td>
              <td class='text-center'><span class='label label-success' aria-hidden='true' data-toggle='tooltip' data-placement='top' title="Accepted">AC</span></td><td class='text-right'>7 ms</td><td class='text-right'>4952 KiB</td>
              <td class="text-center"><a href="/contests/abc175/submissions/80592532">Detail</a></td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="pagination pagination-sm"><li class="active"><a href='/contests/abc175/submissions?page=1'>1</a></li></ul>`,
    );

    const result = await queryCrossOjRecords({
      handles: ["Hardy_Zheng"],
      problem: atcoderProblem,
      requestPage,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      oj: "atcoder",
      submissionId: "80592532",
      problemId: "abc175_f",
      evaluationStatus: "accepted",
      score: 600,
      observedAt: Date.parse("2026-11-04T16:59:22+09:00"),
      detailUrl: "https://atcoder.jp/contests/abc175/submissions/80592532",
    });
  });

  it("refreshes AtCoder from a small overlap before the cached contest cursor", async () => {
    const requestPage = vi.fn(async (_url: string) =>
      atCoderSubmissionPage([]),
    );
    const result = await queryCrossOjRecords({
      handles: ["atcoder-user"],
      problem: atcoderProblem,
      cursors: { "atcoder-user": 1_500 },
      requestPage,
    });

    expect(
      new URL(requestPage.mock.calls[0]![0]).searchParams.get("page"),
    ).toBeNull();
    expect(result.cursors).toEqual({ "atcoder-user": 1_500 });
  });

  it("returns the newest AtCoder page first, then continues from its cached page offset", async () => {
    const requestPage = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      return page === 1
        ? atCoderSubmissionPage(
            [
              {
                id: 101,
                epochSecond: 1_010,
                taskId: "abc175_f",
                status: "AC",
              },
            ],
            true,
          )
        : atCoderSubmissionPage([
            {
              id: 100,
              epochSecond: 1_000,
              taskId: "abc175_f",
              status: "WA",
            },
          ]);
    });
    const recent = await queryCrossOjRecords({
      handles: ["atcoder-user"],
      problem: atcoderProblem,
      requestPage,
      pageBudget: 1,
    });

    expect(requestPage).toHaveBeenCalledTimes(1);
    expect(recent.records.map((record) => record.submissionId)).toEqual([
      "101",
    ]);
    expect(recent.scanOffsets).toEqual({ "atcoder-user": 2 });
    expect(recent.hasMore).toBe(true);

    const older = await queryCrossOjRecords({
      handles: ["atcoder-user"],
      problem: atcoderProblem,
      requestPage,
      cursors: recent.cursors,
      scanOffsets: recent.scanOffsets,
      cachedRecords: recent.records,
      continueScan: true,
      pageBudget: 1,
    });
    expect(
      new URL(requestPage.mock.calls[1]![0]).searchParams.get("page"),
    ).toBe("2");
    expect(older.records.map((record) => record.submissionId)).toEqual(["100"]);
    expect(older.scanOffsets).toEqual({ "atcoder-user": 0 });
    expect(older.hasMore).toBe(false);
  });

  it("continues an incremental Codeforces scan without losing older matching records", async () => {
    const requestPage = vi.fn(async (url: string) => {
      const from = Number(new URL(url).searchParams.get("from"));
      if (from === 1)
        return {
          status: "OK",
          result: [
            {
              id: 2_000,
              creationTimeSeconds: 2_000,
              verdict: "OK",
              problem: { contestId: 1, index: "A" },
            },
            ...Array.from({ length: 999 }, (_, index) => ({
              id: 1_999 - index,
              creationTimeSeconds: 1_999 - index,
              verdict: "OK",
              problem: { contestId: 1, index: "B" },
            })),
          ],
        };
      return {
        status: "OK",
        result: [
          {
            id: 1_000,
            creationTimeSeconds: 1_000,
            verdict: "WRONG_ANSWER",
            problem: { contestId: 1, index: "A" },
          },
        ],
      };
    });
    const recent = await queryCrossOjRecords({
      handles: ["alpha"],
      problem: codeforcesProblem,
      requestPage,
      pageBudget: 1,
    });
    expect(recent.records.map((record) => record.submissionId)).toEqual([
      "2000",
    ]);
    expect(recent.scanOffsets).toEqual({ alpha: 1001 });
    expect(recent.hasMore).toBe(true);

    const older = await queryCrossOjRecords({
      handles: ["alpha"],
      problem: codeforcesProblem,
      requestPage,
      cursors: recent.cursors,
      scanOffsets: recent.scanOffsets,
      cachedRecords: recent.records,
      continueScan: true,
      pageBudget: 1,
    });
    expect(
      new URL(requestPage.mock.calls[1]![0]).searchParams.get("from"),
    ).toBe("1001");
    expect(older.records.map((record) => record.submissionId)).toEqual([
      "1000",
    ]);
    expect(older.scanOffsets).toEqual({ alpha: 0 });
    expect(older.hasMore).toBe(false);
  });

  it("reports absent accounts and keeps successful accounts when one fails", async () => {
    const noAccounts = await queryCrossOjRecords({
      handles: [],
      problem: codeforcesProblem,
      requestPage: vi.fn(),
    });
    expect(noAccounts.records).toEqual([]);
    expect(noAccounts.message).toContain("配置并启用");

    const partiallyFailed = await queryCrossOjRecords({
      handles: ["broken", "working"],
      problem: codeforcesProblem,
      requestPage: async (url) => {
        if (new URL(url).searchParams.get("handle") === "broken")
          throw new Error("API unavailable");
        return {
          status: "OK",
          result: [
            {
              id: 8,
              creationTimeSeconds: 800,
              verdict: "OK",
              problem: { contestId: 1, index: "A" },
            },
          ],
        };
      },
    });
    expect(
      partiallyFailed.records.map((record) => record.submissionId),
    ).toEqual(["8"]);
    expect(partiallyFailed.incomplete).toBe(true);
    expect(partiallyFailed.message).toContain("部分账号");
  });
});
