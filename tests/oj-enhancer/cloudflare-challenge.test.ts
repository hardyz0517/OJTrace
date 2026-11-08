import { describe, expect, it } from "vitest";
import {
  installCloudflareChallengeXhrTimeoutPatch,
  isCloudflareChallengeRequest,
} from "../../src/oj-enhancer/features/cloudflare-challenge/xhr-timeout";

describe("Cloudflare challenge XHR timeout patch", () => {
  it("recognizes only challenge-platform requests", () => {
    expect(
      isCloudflareChallengeRequest(
        "/cdn-cgi/challenge-platform/h/g/flow",
        "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/",
      ),
    ).toBe(true);
    expect(
      isCloudflareChallengeRequest(
        "https://codeforces.com/cdn-cgi/challenge-platform/flow",
        "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/",
      ),
    ).toBe(false);
    expect(
      isCloudflareChallengeRequest(
        "/cdn-cgi/challenge-platform-other/flow",
        "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/",
      ),
    ).toBe(false);
  });

  it("clears the timeout immediately before sending a challenge request", () => {
    const sentTimeouts: number[] = [];
    class FakeXhr {
      timeout = 15_000;

      open(_method: string, _url: string): void {
        // The real XHR stores the URL internally; the hook stores it itself.
      }

      send(): void {
        sentTimeouts.push(this.timeout);
      }
    }
    const page = {
      location: {
        href: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/",
      },
      XMLHttpRequest: FakeXhr,
    };

    expect(installCloudflareChallengeXhrTimeoutPatch(page)).toBe(true);
    const request = new FakeXhr();
    request.open("POST", "/cdn-cgi/challenge-platform/flow");
    request.send();
    expect(sentTimeouts).toEqual([0]);
  });

  it("is idempotent and leaves unrelated requests unchanged", () => {
    const sentTimeouts: number[] = [];
    class FakeXhr {
      timeout = 9_000;

      open(_method: string, _url: string): void {}

      send(): void {
        sentTimeouts.push(this.timeout);
      }
    }
    const page = {
      location: {
        href: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/",
      },
      XMLHttpRequest: FakeXhr,
    };

    expect(installCloudflareChallengeXhrTimeoutPatch(page)).toBe(true);
    expect(installCloudflareChallengeXhrTimeoutPatch(page)).toBe(false);
    const request = new FakeXhr();
    request.open("GET", "https://challenges.cloudflare.com/other");
    request.send();
    expect(sentTimeouts).toEqual([9_000]);
  });

  it("does not patch XHR on an ordinary OJ page", () => {
    class FakeXhr {
      timeout = 9_000;

      open(_method: string, _url: string): void {}

      send(): void {}
    }

    expect(
      installCloudflareChallengeXhrTimeoutPatch({
        location: { href: "https://atcoder.jp/contests/abc/submit" },
        XMLHttpRequest: FakeXhr,
      }),
    ).toBe(false);
  });
});
