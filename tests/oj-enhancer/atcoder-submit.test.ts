import { describe, expect, it } from "vitest";
import {
  atCoderProblemIdsMatch,
  atcoderSubmissionTimestamp,
  isAtCoderSubmissionIdCorrelated,
  atcoderSubmissionFromUrl,
  atcoderSubmitUrl,
  isAtCoderSubmissionTimeCorrelated,
  isLuoguAtCoderProblemId,
  parseAtCoderProblemUrl,
  parseAtCoderSubmitUrl,
  parseLuoguAtCoderProblem,
} from "../../src/oj-enhancer/features/cross-oj-submit/atcoder";
import { findAtCoderCpp23Language } from "../../src/oj-enhancer/features/cross-oj-submit/atcoder-language";

describe("AtCoder cross-OJ routes", () => {
  it("parses Luogu IDs and task links without guessing", () => {
    const fromPid = parseLuoguAtCoderProblem("AT_abc175_f");
    expect(fromPid).toMatchObject({
      contestId: "abc175",
      taskId: "abc175_f",
    });
    expect(
      parseAtCoderProblemUrl(
        "https://atcoder.jp/contests/abc175/tasks/abc175_f",
      ),
    ).toMatchObject({ contestId: "abc175", taskId: "abc175_f" });
    expect(
      parseAtCoderProblemUrl(
        "https://atcoder.jp.evil.example/contests/abc175/tasks/abc175_f",
      ),
    ).toBeUndefined();
    expect(atCoderProblemIdsMatch(fromPid!, fromPid!)).toBe(true);
    expect(atcoderSubmitUrl(fromPid!)).toBe(
      "https://atcoder.jp/contests/abc175/submit",
    );
  });

  it("uses Luogu's original AtCoder link for nonstandard problem IDs", () => {
    const problem = parseLuoguAtCoderProblem(
      "AT1202Contest_h",
      "https://atcoder.jp/contests/DEGwer2023/tasks/1202Contest_h",
    );
    expect(problem).toMatchObject({
      contestId: "degwer2023",
      taskId: "1202contest_h",
      source: "luogu-origin-link",
      originUrl: "https://atcoder.jp/contests/DEGwer2023/tasks/1202Contest_h",
    });
    expect(atcoderSubmitUrl(problem!)).toBe(
      "https://atcoder.jp/contests/degwer2023/submit",
    );
    expect(parseLuoguAtCoderProblem("AT1202Contest_h")).toBeUndefined();
    expect(isLuoguAtCoderProblemId("AT1202Contest_h")).toBe(true);
    expect(isLuoguAtCoderProblemId("AT_abc175_f")).toBe(true);
    expect(isLuoguAtCoderProblemId("CF1202H")).toBe(false);
    expect(
      parseLuoguAtCoderProblem(
        "AT1202Contest_h",
        "https://atcoder.jp/contests/DEGwer2023/tasks/another_task",
      ),
    ).toBeUndefined();
  });

  it("parses login, submit and submission detail routes", () => {
    expect(parseAtCoderSubmitUrl("https://atcoder.jp/login")).toEqual({
      kind: "login",
    });
    expect(
      parseAtCoderSubmitUrl("https://atcoder.jp/contests/abc001/submit"),
    ).toEqual({ kind: "submit", contestId: "abc001" });
    expect(
      parseAtCoderSubmitUrl(
        "https://atcoder.jp/contests/abc001/submissions/me",
      ),
    ).toEqual({ kind: "submission-list", contestId: "abc001" });
    expect(
      atcoderSubmissionFromUrl(
        "https://atcoder.jp/contests/abc001/submissions/12345678",
      ),
    ).toEqual({ contestId: "abc001", submissionId: "12345678" });
  });
});

describe("AtCoder language matching", () => {
  it("always picks an available C++23 option regardless of the Luogu language", () => {
    expect(
      findAtCoderCpp23Language([
        { value: "6017", label: "C++23 (GCC 15.2.0)" },
        { value: "6000", label: "C++20 (GCC 12.2.0)" },
      ]),
    ).toEqual({ value: "6017", label: "C++23 (GCC 15.2.0)" });
    expect(findAtCoderCpp23Language([])).toBeUndefined();
  });
});

describe("AtCoder submission result correlation", () => {
  it("rejects an older same-problem submission from a previous attempt", () => {
    const startedAt = 1_000_000;
    expect(
      isAtCoderSubmissionTimeCorrelated({
        submittedAt: startedAt + 1_000,
        startedAt,
        now: startedAt + 2_000,
      }),
    ).toBe(true);
    expect(
      isAtCoderSubmissionTimeCorrelated({
        submittedAt: startedAt - 60_000,
        startedAt,
        now: startedAt + 2_000,
      }),
    ).toBe(false);
  });

  it("reads official AtCoder row timestamps in epoch, datetime, or text form", () => {
    expect(atcoderSubmissionTimestamp({ unixSeconds: "1730700000" })).toBe(
      1_730_700_000_000,
    );
    expect(
      atcoderSubmissionTimestamp({ datetime: "2026-11-04T10:00:00+09:00" }),
    ).toBe(Date.parse("2026-11-04T10:00:00+09:00"));
    expect(atcoderSubmissionTimestamp({ text: "not a timestamp" })).toBe(
      undefined,
    );
  });

  it("uses the highest known submission ID as a fallback when rows have no time", () => {
    expect(
      isAtCoderSubmissionIdCorrelated({
        submissionId: "101",
        baselineSubmissionId: "100",
      }),
    ).toBe(true);
    expect(
      isAtCoderSubmissionIdCorrelated({
        submissionId: "100",
        baselineSubmissionId: "100",
      }),
    ).toBe(false);
    expect(isAtCoderSubmissionIdCorrelated({ submissionId: "101" })).toBe(
      false,
    );
  });
});
