import { describe, expect, it } from "vitest";
import type { Submission } from "../../src/domain";
import { latestSubmissionsPerProblem } from "../../src/domain/submission-filter";

function submission(overrides: Partial<Submission>): Submission {
  return {
    source: "codeforces",
    accountId: "account",
    submissionId: "1",
    identityQuality: "stable",
    problemId: "1A",
    submittedAt: 1,
    verdict: { code: "wrong_answer", raw: "WRONG_ANSWER" },
    fetchedAt: 1,
    ...overrides,
  };
}

describe("latest submissions per problem", () => {
  it("keeps the newest submission for each account and problem", () => {
    const latest = latestSubmissionsPerProblem([
      submission({ submissionId: "old", submittedAt: 1 }),
      submission({ submissionId: "new", submittedAt: 2 }),
      submission({
        accountId: "another-account",
        submissionId: "other-account",
        submittedAt: 1,
      }),
      submission({
        source: "luogu",
        submissionId: "other-source",
        submittedAt: 1,
      }),
    ]);

    expect(latest.map((item) => item.submissionId)).toEqual([
      "new",
      "other-account",
      "other-source",
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(latestSubmissionsPerProblem([])).toEqual([]);
  });
});
