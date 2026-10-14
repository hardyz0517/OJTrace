import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProblemDocument } from "../../../src/problem/domain";
import { bundledPreviewPackages } from "../../../src/problem/render/browser-typst-compiler";
import {
  CODE_THEME_PATH,
  codeThemeBytes,
  MITEX_PACKAGE_KEY,
} from "../../../src/problem/render/code-theme";
import { problemDocumentToTypst } from "../../../src/problem/render/template";

const FONT_FILES = [
  "lmroman10-regular.otf",
  "lmroman10-bold.otf",
  "lmroman10-italic.otf",
  "lmroman10-bolditalic.otf",
  "lmroman12-regular.otf",
  "lmroman12-bold.otf",
  "lmroman12-italic.otf",
  "lmroman17-regular.otf",
  "SimSun.ttf",
  "simhei.ttf",
  "FiraMono-Regular.ttf",
  "FiraMono-Medium.ttf",
  "FiraMono-Bold.ttf",
  "NewCMMath-Book.otf",
  "NewCMMath-Regular.otf",
  "NewCMMath-Bold.otf",
  "NotoSerifCJKsc-Regular.otf",
  "NotoSerifCJKsc-Bold.otf",
  "OJTraceMincho-Regular.otf",
  "OJTraceHei-Regular.otf",
] as const;

const SAMPLE_ROWS = ["ROW-A", "ROW-B", "ROW-C", "ROW-D"] as const;

interface SvgText {
  x: number;
  y: number;
  text: string;
}

function mathLine(parts: readonly string[]): Array<{
  type: "inline-math" | "text";
  value: string;
}> {
  return parts.flatMap((value, index) => {
    const math = { type: "inline-math" as const, value };
    return index === 0 ? [math] : [{ type: "text" as const, value: " " }, math];
  });
}

function svgTextPositions(svg: string): SvgText[] {
  const positions: SvgText[] = [];
  const stack = [{ x: 0, y: 0, scale: 1 }];
  const token =
    /<g\b([^>]*)>|<\/g>|<foreignObject\b([^>]*)>([\s\S]*?)<\/foreignObject>/g;
  for (const match of svg.matchAll(token)) {
    const parent = stack[stack.length - 1];
    if (!parent) break;
    if (match[0].startsWith("</g>")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (match[1] !== undefined) {
      let tx = 0;
      let ty = 0;
      let scale = 1;
      const transform = /transform="([^"]+)"/.exec(match[1])?.[1];
      if (transform) {
        const translated = /translate\(\s*([-\d.]+)[ ,]([-\d.]+)\s*\)/.exec(
          transform,
        );
        if (translated?.[1] && translated[2]) {
          tx = Number(translated[1]);
          ty = Number(translated[2]);
        }
        const scaled = /scale\(\s*([-\d.]+)/.exec(transform);
        if (scaled?.[1]) scale = Number(scaled[1]);
      }
      stack.push({
        x: parent.x + tx * parent.scale,
        y: parent.y + ty * parent.scale,
        scale: parent.scale * scale,
      });
      continue;
    }
    const xAttr = /\bx="([-\d.]+)"/.exec(match[2] ?? "")?.[1];
    const yAttr = /\by="([-\d.]+)"/.exec(match[2] ?? "")?.[1];
    if (!xAttr || !yAttr) continue;
    const text = (match[3] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    positions.push({
      x: parent.x + Number(xAttr) * parent.scale,
      y: parent.y + Number(yAttr) * parent.scale,
      text,
    });
  }
  return positions;
}

function pitches(values: readonly number[]): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    const previous = values[index - 1];
    if (current === undefined || previous === undefined) continue;
    gaps.push(current - previous);
  }
  return gaps;
}

function average(values: readonly number[]): number {
  if (values.length === 0) throw new Error("expected at least one pitch");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe("math sample line pitch", () => {
  it("matches a plain sample and still grows for a tall formula", async () => {
    const view = globalThis as { window?: unknown; document?: unknown };
    view.window ??= globalThis;
    view.document ??= { documentElement: { lang: "en" } };
    const typst = (await import("@myriaddreamin/typst-all-in-one.ts")) as {
      $typst: {
        use: (...providers: unknown[]) => void;
        mapShadow: (path: string, data: Uint8Array) => Promise<void>;
        svg: (options: { mainContent: string }) => Promise<string>;
      };
      TypstSnippet: {
        disableDefaultFontAssets: () => unknown;
        preloadFonts: (fonts: readonly Uint8Array[]) => unknown;
        withAccessModel: (access: unknown) => unknown;
        withPackageRegistry: (registry: unknown) => unknown;
      };
    };
    const fonts = FONT_FILES.map(
      (name) =>
        new Uint8Array(readFileSync(resolve("public/problem-fonts", name))),
    );
    const mitex = new Uint8Array(
      readFileSync(resolve("public/problem-packages/mitex-0.2.5.tar.gz")),
    );
    typst.$typst.use(
      typst.TypstSnippet.disableDefaultFontAssets(),
      typst.TypstSnippet.preloadFonts(fonts),
      ...bundledPreviewPackages(
        typst.TypstSnippet,
        new Map([[MITEX_PACKAGE_KEY, mitex]]),
      ),
    );
    await typst.$typst.mapShadow(CODE_THEME_PATH, codeThemeBytes());
    const subscript = (row: string) =>
      mathLine([`A_{${row}, 1}`, `A_{${row}, 2}`, "\\ldots", `A_{${row}, N}`]);
    const document: ProblemDocument = {
      oj: "atcoder",
      problemId: "arc083_b",
      title: "Restoring Road Network",
      originalUrl: "https://atcoder.jp/contests/abc074/tasks/arc083_b",
      timeLimit: { display: "2 sec", milliseconds: 2_000 },
      memoryLimit: { display: "256 MiB", bytes: 256 * 1024 * 1024 },
      language: "en",
      blocks: [
        {
          type: "heading",
          level: 2,
          children: [{ type: "text", value: "Inputs" }],
        },
        {
          type: "code",
          value: "N",
          lines: [
            [{ type: "inline-math", value: "N" }],
            subscript("1"),
            subscript("2"),
            [{ type: "inline-math", value: "\\frac{A_{1, 1}}{A_{N, N}}" }],
            subscript("N"),
          ],
        },
        {
          type: "sample",
          input: { type: "code", value: SAMPLE_ROWS.join("\n") },
        },
      ],
      markdown: "",
      assets: [],
      warnings: [],
    };
    const source = problemDocumentToTypst(document);
    expect(source).toContain("par.leading");
    expect(source).not.toContain("sample-pitch");
    expect(source).not.toContain("height: calc.max");
    const svg = await typst.$typst.svg({ mainContent: source });
    const positions = svgTextPositions(svg);
    const sampleYs = SAMPLE_ROWS.map((label) => {
      const found = positions.find((item) => item.text === label);
      if (!found) {
        throw new Error(`missing sample row ${label}`);
      }
      return found.y;
    });
    const firstSample = sampleYs[0];
    if (firstSample === undefined) throw new Error("missing sample pitch");
    const mathYs = positions
      .filter(
        (item) =>
          item.x < 80 && /^\d+$/.test(item.text) && item.y < firstSample - 8,
      )
      .map((item) => item.y)
      .sort((left, right) => left - right);
    const sampleGaps = pitches(sampleYs);
    const mathGaps = pitches(mathYs);
    const detail = `math ${mathGaps.map((gap) => gap.toFixed(2)).join(", ")} sample ${sampleGaps.map((gap) => gap.toFixed(2)).join(", ")}`;
    if (mathYs.length !== 5) {
      throw new Error(
        `expected 5 math line numbers, got ${mathYs.length}; ${detail}`,
      );
    }
    const samplePitch = average(sampleGaps);
    const normalGaps = mathGaps.slice(0, 3);
    const mathPitch = average(normalGaps);
    if (Math.abs(mathPitch - samplePitch) >= 0.45) {
      throw new Error(
        `math pitch ${mathPitch.toFixed(2)} != sample ${samplePitch.toFixed(2)}; ${detail}`,
      );
    }
    for (const gap of normalGaps) {
      expect(Math.abs(gap - samplePitch)).toBeLessThan(0.45);
    }
    const afterTall = mathGaps[3];
    if (afterTall === undefined) {
      throw new Error(`incomplete math gaps; ${detail}`);
    }
    if (afterTall <= mathPitch + 1) {
      throw new Error(`tall formula did not grow; ${detail}`);
    }
  }, 60_000);
});
