import { describe, expect, it } from "vitest";
import { isAllowedNavigation } from "../../src/platform/permissions/hosts";

describe("navigation allowlist", () => {
  it("accepts only HTTPS URLs on the source host", () => {
    expect(
      isAllowedNavigation(
        "codeforces",
        "https://codeforces.com/contest/1/submission/2",
      ),
    ).toBe(true);
    expect(
      isAllowedNavigation(
        "codeforces",
        "http://codeforces.com/contest/1/submission/2",
      ),
    ).toBe(false);
    expect(
      isAllowedNavigation("codeforces", "https://evil.example/redirect"),
    ).toBe(false);
    expect(
      isAllowedNavigation(
        "luogu",
        "https://www.luogu.com.cn/record/list?user=1",
      ),
    ).toBe(true);
  });
});
