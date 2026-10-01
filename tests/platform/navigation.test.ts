import { describe, expect, it } from "vitest";
import { isAllowedNavigation } from "../../src/platform/permissions/hosts";
import {
  CustomOriginValidationError,
  exactOriginPermissionPattern,
  normalizeCustomHttpsOrigin,
} from "../../src/platform/permissions/custom-origin";

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

describe("custom instance origins", () => {
  it("normalizes exact HTTPS root origins", () => {
    expect(normalizeCustomHttpsOrigin("https://hydro.example.org/")).toBe(
      "https://hydro.example.org",
    );
    expect(exactOriginPermissionPattern("https://hydro.example.org")).toBe(
      "https://hydro.example.org/*",
    );
    expect(
      exactOriginPermissionPattern("http://106.55.100.251", {
        allowHttp: true,
      }),
    ).toBe("http://106.55.100.251/*");
    expect(
      exactOriginPermissionPattern("http://hydro.example.org", {
        allowHttp: true,
      }),
    ).toBe("http://hydro.example.org/*");
  });

  it.each([
    "http://hydro.example.org",
    "https://user:pass@hydro.example.org",
    "https://hydro.example.org/app",
    "https://hydro.example.org/?next=1",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://[::1]",
    "https://[fc00::1]",
  ])("rejects unsafe custom origin %s", (value) => {
    if (value.startsWith("http:")) {
      expect(normalizeCustomHttpsOrigin(value, { allowHttp: true })).toBe(
        value,
      );
    } else {
      expect(() => normalizeCustomHttpsOrigin(value)).toThrow(
        CustomOriginValidationError,
      );
    }
  });
});
