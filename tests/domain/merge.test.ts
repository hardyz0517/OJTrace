import { describe, expect, it } from "vitest";
import { mergeSubmissions } from "../../src/domain/merge";
import type { Submission } from "../../src/domain";

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

describe("submission merge", () => {
  it("deduplicates by source, account and submission ID", () => {
    const merged = mergeSubmissions(
      [submission({ problemName: undefined })],
      [
        submission({
          verdict: { code: "accepted", raw: "OK" },
          problemName: "A + B",
          fetchedAt: 2,
        }),
      ],
      2_000,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.verdict.code).toBe("accepted");
    expect(merged[0]!.problemName).toBe("A + B");
  });

  it("keeps identical IDs from different accounts separate", () => {
    const merged = mergeSubmissions(
      [submission({ accountId: "a" })],
      [submission({ accountId: "b" })],
      2_000,
    );
    expect(merged).toHaveLength(2);
  });

  it("applies retention per account after sorting", () => {
    const merged = mergeSubmissions(
      [
        submission({ submissionId: "old", submittedAt: 1 }),
        submission({ submissionId: "new", submittedAt: 3 }),
      ],
      [],
      1,
    );
    expect(merged.map((item) => item.submissionId)).toEqual(["new"]);
  });
});
