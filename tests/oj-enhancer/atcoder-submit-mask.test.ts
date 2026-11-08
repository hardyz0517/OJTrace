// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  hideAtCoderSubmitMask,
  showAtCoderSubmitMask,
  showCrossOjSubmitMask,
  hideCrossOjSubmitMask,
} from "../../src/oj-enhancer/features/cross-oj-submit/submit-mask";

afterEach(() => {
  hideAtCoderSubmitMask();
  hideCrossOjSubmitMask();
  document.body.replaceChildren();
  document.documentElement.style.removeProperty("visibility");
});

describe("AtCoder submit mask", () => {
  it("covers the target page and restores a challenge widget's inline style", () => {
    document.documentElement.style.setProperty(
      "visibility",
      "visible",
      "important",
    );
    const challenge = document.createElement("div");
    challenge.className = "cf-turnstile";
    challenge.setAttribute("style", "color: red");
    document.body.append(challenge);

    showAtCoderSubmitMask("正在等待验证");

    expect(
      document.getElementById("ojtrace-atcoder-submit-mask"),
    ).not.toBeNull();
    expect(document.documentElement.style.getPropertyValue("visibility")).toBe(
      "hidden",
    );
    expect(challenge.style.position).toBe("fixed");
    expect(challenge.style.visibility).toBe("visible");

    hideAtCoderSubmitMask();

    expect(document.getElementById("ojtrace-atcoder-submit-mask")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("visibility")).toBe(
      "visible",
    );
    expect(
      document.documentElement.style.getPropertyPriority("visibility"),
    ).toBe("important");
    expect(challenge.getAttribute("style")).toBe("color: red");
  });

  it("keeps a single mask while updating its status", () => {
    showAtCoderSubmitMask("加载中");
    showAtCoderSubmitMask("验证中");

    expect(
      document.querySelectorAll("#ojtrace-atcoder-submit-mask"),
    ).toHaveLength(1);
    expect(
      document.querySelector<HTMLElement>(
        "#ojtrace-atcoder-submit-mask [data-role='status']",
      )?.textContent,
    ).toBe("验证中");
  });

  it("moves a challenge widget that appears after the mask", async () => {
    showAtCoderSubmitMask("等待 AtCoder 安全验证");
    const challenge = document.createElement("div");
    challenge.className = "cf-turnstile";
    document.body.append(challenge);
    await Promise.resolve();

    expect(challenge.style.position).toBe("fixed");
    expect(
      document.querySelector<HTMLElement>(
        "#ojtrace-atcoder-submit-mask [data-role='challenge-placeholder']",
      )?.hidden,
    ).toBe(true);

    hideAtCoderSubmitMask();
    expect(challenge.hasAttribute("style")).toBe(false);
  });

  it("uses the same full-page workflow mask for Codeforces", () => {
    const challenge = document.createElement("iframe");
    challenge.src = "https://challenges.cloudflare.com/widget";
    document.body.append(challenge);

    showCrossOjSubmitMask("codeforces", "正在 Codeforces 提交页准备代码…");

    expect(
      document.getElementById("ojtrace-codeforces-submit-mask"),
    ).not.toBeNull();
    expect(
      document.querySelector(
        "#ojtrace-codeforces-submit-mask [data-role='status']",
      )?.textContent,
    ).toBe("正在 Codeforces 提交页准备代码…");
    expect(
      document.querySelector("#ojtrace-codeforces-submit-mask")?.textContent,
    ).toContain("OJTrace · Codeforces");
    expect(challenge.style.visibility).toBe("visible");
    expect(challenge.style.pointerEvents).toBe("auto");

    hideCrossOjSubmitMask();
    expect(
      document.getElementById("ojtrace-codeforces-submit-mask"),
    ).toBeNull();
    expect(document.documentElement.style.getPropertyValue("visibility")).toBe(
      "",
    );
    expect(challenge.hasAttribute("style")).toBe(false);
  });
});
