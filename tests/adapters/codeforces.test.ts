import { describe, expect, it } from "vitest";
import { normalizeCodeforcesSubmission } from "../../src/adapters/codeforces/normalizer";
import { parseCodeforcesResponse } from "../../src/adapters/codeforces/parser";
import { codeforcesAdapter } from "../../src/adapters/codeforces";

describe("Codeforces parser and normalizer", () => {
  it("parses a successful response and normalizes epoch seconds", () => {
    const parsed = parseCodeforcesResponse(
      JSON.stringify({
        status: "OK",
        result: [
          {
            id: 42,
            contestId: 10,
            creationTimeSeconds: 1_700_000_000,
            problem: { contestId: 10, index: "A", name: "A + B" },
            programmingLanguage: "GNU C++17",
            verdict: "OK",
          },
        ],
      }),
    );
    const result = normalizeCodeforcesSubmission(
      parsed.result![0]!,
      "local",
      "tourist",
      1_700_000_100_000,
    );
    expect(result.submissionId).toBe("42");
    expect(result.submittedAt).toBe(1_700_000_000_000);
    expect(result.verdict.code).toBe("accepted");
    expect(result.submissionUrl).toBe(
      "https://codeforces.com/contest/10/submission/42",
    );
  });

  it("keeps unknown verdicts instead of throwing", () => {
    const result = normalizeCodeforcesSubmission(
      { id: 1, creationTimeSeconds: 1, verdict: "NEW_STATUS" },
      "local",
      "tourist",
      2,
    );
    expect(result.verdict.code).toBe("other");
    expect(result.verdict.raw).toBe("NEW_STATUS");
  });

  it("uses the gym URL shape for current gym contest ids", () => {
    const result = normalizeCodeforcesSubmission(
      {
        id: 9,
        contestId: 104976,
        creationTimeSeconds: 1_700_000_000,
        problem: { index: "D", name: "Gym problem" },
        verdict: "OK",
      },
      "local",
      "tourist",
      1_700_000_001_000,
    );
    expect(result.submissionUrl).toContain("/gym/104976/submission/9");
    expect(result.problemUrl).toContain("/gym/104976/problem/D");
  });

  it("rejects malformed response status", () => {
    expect(() => parseCodeforcesResponse("{}")).toThrow(
      "Codeforces response has invalid status",
    );
  });

  it("fetches through the constrained HttpClient contract", async () => {
    const response = JSON.stringify({
      status: "OK",
      result: [{ id: 9, creationTimeSeconds: 10, verdict: "WRONG_ANSWER" }],
    });
    const result = await codeforcesAdapter.fetchRecent({
      account: {
        accountId: "account",
        source: "codeforces",
        identifier: "tourist",
        enabled: true,
        authMode: "public",
      },
      limit: 10,
      signal: new AbortController().signal,
      now: 100,
      requestId: "request",
      http: {
        request: async () => ({
          status: 200,
          url: "https://codeforces.com/api/user.status",
          contentType: "application/json",
          text: response,
          headers: new Headers(),
        }),
      },
    });
    expect(result.records[0]!.verdict.code).toBe("wrong_answer");
  });
});
