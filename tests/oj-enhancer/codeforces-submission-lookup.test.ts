import { describe, expect, it } from "vitest";
import {
  codeforcesUserStatusUrl,
  latestCodeforcesSubmissionId,
  lookupCodeforcesSubmission,
} from "../../src/oj-enhancer/features/cross-oj-submit/codeforces-submission-lookup";

const problem = {
  oj: "codeforces",
  contestId: "1",
  index: "A",
  source: "luogu-pid",
} as const;

function submission(input: {
  id: number;
  handle?: string;
  contestId?: number;
  index?: string;
  creationTimeSeconds?: number;
}): Record<string, unknown> {
  return {
    id: input.id,
    contestId: input.contestId ?? 1,
    creationTimeSeconds: input.creationTimeSeconds ?? 1_700_000_010,
    problem: { contestId: input.contestId ?? 1, index: input.index ?? "A" },
    author: { members: [{ handle: input.handle ?? "tourist" }] },
  };
}

describe("Codeforces submission lookup", () => {
  it("builds an allowlisted user.status request and reads the baseline ID", () => {
    expect(codeforcesUserStatusUrl("tourist", 1)).toBe(
      "https://codeforces.com/api/user.status?handle=tourist&from=1&count=1",
    );
    expect(codeforcesUserStatusUrl("bad/handle", 1)).toBeUndefined();
    expect(
      latestCodeforcesSubmissionId({
        status: "OK",
        result: [{ id: 100 }, { id: 105 }],
      }),
    ).toBe("105");
    expect(latestCodeforcesSubmissionId({ status: "OK", result: [] })).toBe(
      "0",
    );
    expect(latestCodeforcesSubmissionId({ status: "FAILED" })).toBeUndefined();
  });

  it("matches a single new submission by baseline, account, problem, and time", () => {
    expect(
      lookupCodeforcesSubmission(
        {
          status: "OK",
          result: [
            submission({ id: 99, creationTimeSeconds: 1_700_000_001 }),
            submission({ id: 101, creationTimeSeconds: 1_700_000_010 }),
          ],
        },
        {
          problem,
          handle: "tourist",
          baselineSubmissionId: "100",
          submitObservedAt: 1_700_000_010_000,
          now: 1_700_000_020_000,
        },
      ),
    ).toEqual({
      status: "matched",
      detailUrl: "https://codeforces.com/contest/1/submission/101",
    });
  });

  it("refuses stale, wrong-account, wrong-problem, and ambiguous candidates", () => {
    const base = {
      problem,
      handle: "tourist",
      baselineSubmissionId: "100",
      submitObservedAt: 1_700_000_010_000,
      now: 1_700_000_020_000,
    };
    expect(
      lookupCodeforcesSubmission(
        {
          status: "OK",
          result: [submission({ id: 99, creationTimeSeconds: 1_700_000_009 })],
        },
        base,
      ),
    ).toEqual({ status: "pending" });
    expect(
      lookupCodeforcesSubmission(
        {
          status: "OK",
          result: [submission({ id: 101, handle: "someoneelse" })],
        },
        base,
      ),
    ).toEqual({ status: "pending" });
    expect(
      lookupCodeforcesSubmission(
        {
          status: "OK",
          result: [submission({ id: 101, index: "B" })],
        },
        base,
      ),
    ).toEqual({ status: "pending" });
    expect(
      lookupCodeforcesSubmission(
        {
          status: "OK",
          result: [submission({ id: 101, creationTimeSeconds: 1_700_000_041 })],
        },
        { ...base, now: 1_700_000_100_000 },
      ),
    ).toEqual({ status: "pending" });
    expect(
      lookupCodeforcesSubmission(
        {
          status: "OK",
          result: [submission({ id: 101 }), submission({ id: 102 })],
        },
        base,
      ),
    ).toEqual({ status: "ambiguous" });
  });
});
