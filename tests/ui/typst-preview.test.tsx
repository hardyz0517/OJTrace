// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  mountTypstSvg,
  parseTypstSvg,
} from "../../entrypoints/problem-export/TypstPreview";

describe("Typst SVG preview", () => {
  it("preserves glyph references, styles and nested image geometry without scripts", () => {
    const graphic = parseTypstSvg(`<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 596 1684" onclick="unexpected()">
        <style>.typst-text { fill: #123456; }</style>
        <defs><path id="glyph" d="M0 0L10 10" /></defs>
        <g class="typst-page"><use xlink:href="#glyph" /></g>
        <g class="typst-page" transform="translate(0,842)">
          <svg width="100" height="50" viewBox="0 0 100 50"><rect width="100" height="50" /></svg>
        </g>
        <script>unexpected()</script>
      </svg>`);
    const host = document.createElement("div");
    mountTypstSvg(host, graphic);
    const root = host.shadowRoot!;
    const mounted = root.querySelector("svg")!;
    expect(mounted.style.width).toBe("100%");
    expect(mounted.querySelector("svg")?.getAttribute("width")).toBe("100");
    expect(mounted.querySelector("svg")?.getAttribute("style")).toBeNull();
    expect(root.querySelectorAll(".typst-page")).toHaveLength(2);
    expect(root.querySelector("style")?.textContent).toContain("#123456");
    expect(root.querySelector("use")?.getAttribute("xlink:href")).toBe(
      "#glyph",
    );
    expect(root.getElementById("glyph")).not.toBeNull();
    expect(root.querySelector("script")).toBeNull();
    expect(mounted.hasAttribute("onclick")).toBe(false);
  });
});
