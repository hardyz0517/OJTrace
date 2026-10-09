import { describe, expect, it } from "vitest";
import { decodeHtml } from "../../src/adapters/shared/html";

describe("site HTML entity decoding", () => {
  it("preserves the existing ordered pass over named and numeric entities", () => {
    expect(
      decodeHtml("&amp;lt;&amp;#65;&#x1f600;&quot;&#39;&apos;&nbsp;"),
    ).toBe("<A😀\"'' ");
    expect(decodeHtml("&#38;lt; &unknown;")).toBe("&lt; &unknown;");
  });

  it("keeps branding's existing non-breaking-space behavior explicit", () => {
    expect(decodeHtml("a&nbsp;b", { nonBreakingSpace: false })).toBe(
      "a&nbsp;b",
    );
    expect(decodeHtml("a&nbsp;b")).toBe("a b");
  });

  it("keeps invalid code points as parser failures", () => {
    expect(() => decodeHtml("&#1114112;")).toThrow(RangeError);
    expect(() => decodeHtml("&#x110000;")).toThrow(RangeError);
  });
});
