import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledFonts } from "../../../src/problem/render/font-manifest";
import { problemRenderStyle } from "../../../src/problem/render/style-tokens";

function familyNames(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      for (const item of value) names.add(item);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "fontFamily" && typeof child === "string") names.add(child);
    else familyNames(child, names);
  }
}

describe("font manifest", () => {
  it("points at packaged files and covers every style family", () => {
    const declared = new Set<string>(bundledFonts.map((font) => font.family));
    for (const font of bundledFonts) {
      const relative = font.path.replace(/^\//, "");
      expect(relative.startsWith("problem-fonts/")).toBe(true);
      expect(existsSync(resolve("public", relative))).toBe(true);
    }
    const used = new Set<string>();
    familyNames(problemRenderStyle, used);
    for (const family of used) expect(declared.has(family)).toBe(true);
  });
});
