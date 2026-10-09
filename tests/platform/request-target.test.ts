import { describe, expect, it } from "vitest";
import type { HttpRequestOptions } from "../../src/domain/adapter";
import type { SourceId } from "../../src/domain/types";
import { createRequestTargetPolicy } from "../../src/platform/network/request-target";

const cases: Array<[SourceId, string, HttpRequestOptions, boolean]> = [
  ["codeforces", "https://codeforces.com/api/user.status", {}, true],
  ["luogu", "https://www.luogu.com.cn/record/list", {}, true],
  ["qoj", "https://qoj.ac/submissions", {}, true],
  ["atcoder", "https://atcoder.jp/settings", {}, true],
  [
    "hydroj",
    "http://school.example.org/record",
    { hydroOrigin: "http://school.example.org" },
    true,
  ],
  ["hydroj", "https://hydro.ac/record", {}, false],
  ["qoj", "https://atcoder.jp/settings", {}, false],
  ["qoj", "https://user:pass@qoj.ac/submissions", {}, false],
  ["qoj", "http://qoj.ac/submissions", {}, false],
  ["qoj", "malformed", {}, false],
  [
    "atcoder",
    "https://kenkoooo.com/atcoder/resources/problems.json",
    {},
    false,
  ],
  [
    "atcoder",
    "https://kenkoooo.com/atcoder/resources/problems.json",
    { atcoderProblemMetadataApi: true },
    true,
  ],
  [
    "atcoder",
    "https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=u",
    { atcoderProblemsApi: true },
    true,
  ],
  [
    "atcoder",
    "https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions-extra",
    { atcoderProblemsApi: true },
    true,
  ],
  [
    "atcoder",
    "https://kenkoooo.com/contests/abc/submissions/123",
    { atcoderSubmissionPage: true },
    true,
  ],
  [
    "atcoder",
    "https://atcoder.jp/contests/abc/submissions/name",
    { atcoderSubmissionPage: true },
    false,
  ],
  [
    "atcoder",
    "https://kenkoooo.com/atcoder/resources/problems.json",
    { atcoderProblemsApi: true, atcoderProblemMetadataApi: true },
    false,
  ],
];
describe("request and final URL policy", () => {
  it.each(cases)("%s %s options=%j -> %s", (source, url, options, expected) => {
    expect(createRequestTargetPolicy(source, options).allows(url)).toBe(
      expected,
    );
  });
  it("checks original credential scope separately from the final endpoint", () => {
    const policy = createRequestTargetPolicy("atcoder", {
      atcoderSessionCookie: "session",
      atcoderProblemMetadataApi: true,
    });
    expect(
      policy.allows("https://kenkoooo.com/atcoder/resources/problems.json"),
    ).toBe(true);
    expect(
      policy.allowsCredentials(
        "https://kenkoooo.com/atcoder/resources/problems.json",
      ),
    ).toBe(false);
    expect(
      policy.allowsCredentials(
        "https://atcoder.jp/atcoder/resources/problems.json",
      ),
    ).toBe(true);
    expect(
      createRequestTargetPolicy("qoj", {
        atcoderSessionCookie: "session",
      }).allowsCredentials("https://qoj.ac/"),
    ).toBe(false);
  });
});
