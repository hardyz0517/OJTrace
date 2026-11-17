import { describe, expect, it } from "vitest";
import {
  legacyLuoguRecordDetailUrl,
  safeLuoguReturnUrl,
} from "../../src/oj-enhancer/features/cross-oj-submit/record-links";
import { isCrossOjMessage } from "../../src/oj-enhancer/features/cross-oj-submit/model";

describe("official record navigation", () => {
  it.each([
    [
      "CF1A#ojtrace-record=cf/101",
      "https://codeforces.com/contest/1/submission/101",
    ],
    [
      "CF1A#ojtrace-record=cf/1/101",
      "https://codeforces.com/contest/1/submission/101",
    ],
    [
      "AT_abc175_f#ojtrace-record=at/102",
      "https://atcoder.jp/contests/abc175/submissions/102",
    ],
    [
      "AT_abc175_f#ojtrace-record=at/abc175/102",
      "https://atcoder.jp/contests/abc175/submissions/102",
    ],
  ])(
    "redirects the old bookmark %s to its official detail",
    (suffix, expected) => {
      expect(
        legacyLuoguRecordDetailUrl(
          `https://www.luogu.com.cn/record/list?pid=${suffix}`,
        ),
      ).toBe(expected);
    },
  );

  it.each([
    "https://www.luogu.com.cn/record/list?pid=CF1A",
    "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/2/101",
    "https://www.luogu.com.cn/record/list?pid=CF1A&pid=CF1B#ojtrace-record=cf/101",
    "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=at/101",
    "https://www.luogu.com.cn/problem/CF1A#ojtrace-record=cf/101",
    "https://evil.example/record/list?pid=CF1A#ojtrace-record=cf/101",
  ])("ignores ordinary or mismatched URLs %s", (url) => {
    expect(legacyLuoguRecordDetailUrl(url)).toBeUndefined();
  });

  it("keeps manual return links limited to Luogu", () => {
    expect(
      safeLuoguReturnUrl("https://www.luogu.com.cn/problem/CF1A#submit"),
    ).toBe("https://www.luogu.com.cn/problem/CF1A#submit");
    expect(
      safeLuoguReturnUrl("https://www.luogu.com.cn.evil.example/"),
    ).toBeUndefined();
    expect(
      safeLuoguReturnUrl("https://user@www.luogu.com.cn/"),
    ).toBeUndefined();
  });

  it.each(["SAVE_CROSS_OJ_DETAIL", "GET_CROSS_OJ_DETAIL"])(
    "rejects the retired %s message",
    (type) => {
      expect(
        isCrossOjMessage({
          schemaVersion: 1,
          requestId: "retired-detail",
          type,
          submissionId: "101",
        }),
      ).toBe(false);
    },
  );
});
