import { describe, expect, it } from "vitest";
import { parseAtCoderSessionHandle } from "../../src/oj-enhancer/features/cross-oj-submit/atcoder-session";

describe("AtCoder session handle parsing", () => {
  it("reads the official userScreenName marker", () => {
    expect(
      parseAtCoderSessionHandle(
        '<script>var userScreenName = "Hardy_Zheng";</script>',
      ),
    ).toBe("Hardy_Zheng");
  });

  it("supports the profile navigation fallback", () => {
    expect(
      parseAtCoderSessionHandle(
        '<a href="/users/Hardy_Zheng"><span>My Profile</span></a>',
      ),
    ).toBe("Hardy_Zheng");
  });

  it("does not treat a logged-out page as an account", () => {
    expect(
      parseAtCoderSessionHandle('<a href="/login">Sign In</a>'),
    ).toBeUndefined();
  });
});
