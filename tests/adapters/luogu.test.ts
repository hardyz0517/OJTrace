import { describe, expect, it } from "vitest";
import { normalizeLuoguRecord } from "../../src/adapters/luogu/normalizer";
import { parseLuoguResponse } from "../../src/adapters/luogu/parser";

describe("Luogu parser and normalizer", () => {
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
  });

  it("rejects login HTML instead of treating it as empty", () => {
    expect(() =>
      parseLuoguResponse("<!doctype html><html><body>Login</body></html>"),
    ).toThrow("login page");
  });
});
