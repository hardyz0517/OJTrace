import { describe, expect, it } from "vitest";
import {
  atCoderProblemIdsMatch,
  atcoderSubmissionFromUrl,
  atcoderSubmitUrl,
  isLuoguAtCoderProblemId,
  parseAtCoderProblemUrl,
  parseAtCoderSubmitUrl,
  parseLuoguAtCoderProblem,
} from "../../src/oj-enhancer/features/cross-oj-submit/atcoder";
import { matchAtCoderLanguage } from "../../src/oj-enhancer/features/cross-oj-submit/atcoder-language";

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
      atcoderSubmissionFromUrl(
        "https://atcoder.jp/contests/abc001/submissions/12345678",
      ),
    ).toEqual({ contestId: "abc001", submissionId: "12345678" });
  });
});

describe("AtCoder language matching", () => {
  it("matches the current option labels and refuses ambiguous choices", () => {
    expect(
      matchAtCoderLanguage("C++20", [
        { value: "6000", label: "C++20 (GCC 12.2.0)" },
      ]),
    ).toMatchObject({ kind: "matched", option: { value: "6000" } });
    expect(
      matchAtCoderLanguage("Python 3.11", [
        { value: "6082", label: "Python (CPython 3.13.7)" },
        { value: "6083", label: "Python (PyPy 3.11-v7.3.20)" },
      ]),
    ).toMatchObject({ kind: "ambiguous" });
    expect(
      matchAtCoderLanguage("Pascal", [
        { value: "1", label: "C++23 (GCC 15.2.0)" },
      ]),
    ).toEqual({ kind: "unsupported" });
  });
});
