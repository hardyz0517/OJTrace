import { describe, expect, it, vi } from "vitest";
import { queryAtCoderProblemHistoryStatus } from "../../src/oj-enhancer/features/cross-oj-submit/atcoder-problem-status";
import type { AtCoderProblemRef } from "../../src/oj-enhancer/features/cross-oj-submit/model";

const problem: AtCoderProblemRef = {
  oj: "atcoder",
  contestId: "abc001",
  taskId: "abc001_1",
  source: "luogu-pid",
};
function submission(result: string, epochSecond = 2_000) {
  return {
    id: 123,
    epoch_second: epochSecond,
    contest_id: "abc001",
    problem_id: "abc001_1",
    language: "C++ 17",
    point: result === "AC" ? 100 : 0,
    result,
  };
}

function page(items: ReturnType<typeof submission>[]): string {
  const rows = items
    .map(
      (item) => `<tr>
        <td class="no-break"><time class="fixtime-second">${new Date(item.epoch_second * 1000).toISOString().slice(0, 19).replace("T", " ")}+0900</time></td>
        <td><a href="/contests/${item.contest_id}/tasks/${item.problem_id}">A - Task</a></td>
        <td><a href="/users/atcoder-user">atcoder-user</a></td>
        <td>${item.language}</td><td>${item.point}</td><td>100 Byte</td>
        <td><span class="label label-success">${item.result}</span></td><td>1 ms</td><td>1 KiB</td>
        <td><a href="/contests/${item.contest_id}/submissions/${item.id}">Detail</a></td>
      </tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Submission Time</th><th>Task</th><th>User</th><th>Language</th><th>Score</th><th>Code Size</th><th>Status</th><th>Exec Time</th><th>Memory</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

describe("AtCoder problem history status", () => {
  it("counts post-contest practice acceptances", async () => {
    const result = await queryAtCoderProblemHistoryStatus({
      handles: ["atcoder-user"],
      problem,
      requestPage: async () => page([submission("AC")]),
    });

    expect(result).toEqual({ status: "accepted" });
  });

  it("stops scanning once an accepted result is found in a full page", async () => {
    const requestPage = vi.fn(async () =>
      page(
        Array.from({ length: 500 }, (_, index) => ({
          ...submission(index === 499 ? "AC" : "WA", 1_000 + index),
          id: index + 1,
          problem_id: index === 499 ? "abc001_1" : "abc001_2",
        })),
      ),
    );

    const result = await queryAtCoderProblemHistoryStatus({
      handles: ["atcoder-user"],
      problem,
      requestPage,
    });

    expect(result.status).toBe("accepted");
    expect(requestPage).toHaveBeenCalledOnce();
  });

  it("reports unaccepted only after a complete scan", async () => {
    const result = await queryAtCoderProblemHistoryStatus({
      handles: ["atcoder-user"],
      problem,
      requestPage: vi.fn(async () => page([submission("WA")])),
    });

    expect(result).toEqual({ status: "unaccepted" });
  });

  it("distinguishes no submissions from a failed query", async () => {
    const noSubmissions = await queryAtCoderProblemHistoryStatus({
      handles: ["atcoder-user"],
      problem,
      requestPage: vi.fn(async () => page([])),
    });
    expect(noSubmissions).toEqual({ status: "none" });

    const failed = await queryAtCoderProblemHistoryStatus({
      handles: ["atcoder-user"],
      problem,
      requestPage: vi.fn(async () => {
        throw new Error("API unavailable");
      }),
    });
    expect(failed.status).toBe("unavailable");
    expect(failed.message).toContain("API unavailable");
  });

  it("explains when an AtCoder account is not configured", async () => {
    const result = await queryAtCoderProblemHistoryStatus({
      handles: [],
      problem,
      requestPage: vi.fn(),
    });

    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("配置并启用 AtCoder 账号");
  });
});
