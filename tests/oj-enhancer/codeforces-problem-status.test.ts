import { describe, expect, it, vi } from "vitest";
import {
  CODEFORCES_STATUS_PAGE_SIZE,
  codeforcesContestStatusUrl,
  queryCodeforcesProblemHistoryStatus,
} from "../../src/oj-enhancer/features/cross-oj-submit/codeforces-problem-status";

const problem = {
  oj: "codeforces",
  contestId: "1",
  index: "A",
  source: "luogu-pid",
} as const;

function page(result: unknown[]) {
  return { status: "OK", result };
}

function submission(verdict: string, contestId = "1", index = "A") {
  return { problem: { contestId, index }, verdict };
}

describe("Codeforces problem submission history", () => {
  it("builds the official contest status API URL", () => {
    const url = new URL(codeforcesContestStatusUrl("1", "tourist", 1001));
    expect(url.origin).toBe("https://codeforces.com");
    expect(url.pathname).toBe("/api/contest.status");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      contestId: "1",
      handle: "tourist",
      from: "1001",
      count: String(CODEFORCES_STATUS_PAGE_SIZE),
    });
  });

  it("returns accepted when any matching submission is accepted", async () => {
    const requestPage = vi
      .fn()
      .mockResolvedValue(
        page([submission("OK"), submission("WRONG_ANSWER", "1", "B")]),
      );
    await expect(
      queryCodeforcesProblemHistoryStatus({
        handles: ["tourist"],
        problem,
        requestPage,
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(requestPage).toHaveBeenCalledTimes(1);
  });

  it("returns unaccepted when the problem has submissions but none is accepted", async () => {
    const requestPage = vi
      .fn()
      .mockResolvedValue(
        page([submission("WRONG_ANSWER"), submission("TIME_LIMIT_EXCEEDED")]),
      );
    await expect(
      queryCodeforcesProblemHistoryStatus({
        handles: ["tourist"],
        problem,
        requestPage,
      }),
    ).resolves.toEqual({ status: "unaccepted" });
  });

  it("returns none when no enabled handle submitted the problem", async () => {
    const requestPage = vi
      .fn()
      .mockResolvedValue(page([submission("OK", "1", "B")]));
    await expect(
      queryCodeforcesProblemHistoryStatus({
        handles: ["tourist"],
        problem,
        requestPage,
      }),
    ).resolves.toEqual({ status: "none" });
  });

  it("paginates when a target submission is older than the first page", async () => {
    const firstPage = Array.from({ length: CODEFORCES_STATUS_PAGE_SIZE }, () =>
      submission("OK", "2", "A"),
    );
    const requestPage = vi
      .fn()
      .mockResolvedValueOnce(page(firstPage))
      .mockResolvedValueOnce(page([submission("OK")]));
    await expect(
      queryCodeforcesProblemHistoryStatus({
        handles: ["tourist"],
        problem,
        requestPage,
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(requestPage).toHaveBeenCalledTimes(2);
    expect(
      new URL(requestPage.mock.calls[1]![0]!).searchParams.get("from"),
    ).toBe("1001");
  });

  it("checks each distinct enabled account and merges its result", async () => {
    const requestPage = vi
      .fn()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([submission("OK")]));
    await expect(
      queryCodeforcesProblemHistoryStatus({
        handles: ["tourist", "TOURIST", "second_handle"],
        problem,
        requestPage,
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(requestPage).toHaveBeenCalledTimes(2);
    expect(requestPage.mock.calls[0]![0]).toContain("handle=tourist");
    expect(requestPage.mock.calls[1]![0]).toContain("handle=second_handle");
  });

  it("does not turn API errors into a false no-submission result", async () => {
    const requestPage = vi.fn().mockRejectedValue(new Error("HTTP 503"));
    await expect(
      queryCodeforcesProblemHistoryStatus({
        handles: ["tourist"],
        problem,
        requestPage,
      }),
    ).resolves.toMatchObject({ status: "unavailable", message: /HTTP 503/ });
  });

  it("still returns accepted if a different account request fails", async () => {
    const requestPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 503"))
      .mockResolvedValueOnce(page([submission("OK")]));
    await expect(
      queryCodeforcesProblemHistoryStatus({
        handles: ["first_user", "second_user"],
        problem,
        requestPage,
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(requestPage).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable instead of none when no enabled handle is configured", async () => {
    const requestPage = vi.fn();
    await expect(
      queryCodeforcesProblemHistoryStatus({
        handles: [],
        problem,
        requestPage,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    expect(requestPage).not.toHaveBeenCalled();
  });
});
