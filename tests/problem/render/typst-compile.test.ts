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

const statement: ProblemDocument = {
  oj: "luogu",
  problemId: "P1450",
  title: "购物",
  originalUrl: "https://www.luogu.com.cn/problem/P1450",
  timeLimit: { display: "1 s", milliseconds: 1_000 },
  memoryLimit: { display: "128 MB", bytes: 128 * 1024 * 1024 },
  language: "zh",
  blocks: [
    {
      type: "heading",
      level: 2,
      children: [{ type: "text", value: "题目描述" }],
    },
    {
      type: "paragraph",
      children: [
        { type: "text", value: "共有 " },
        { type: "inline-math", value: "n" },
        { type: "text", value: " 种硬币，其中 " },
        { type: "strong", children: [{ type: "text", value: "至多" }] },
        { type: "text", value: " 买 " },
        { type: "inline-math", value: "c_i" },
        { type: "text", value: "。" },
      ],
    },
    {
      type: "paragraph",
      children: [
        { type: "text", value: "从文件 " },
        { type: "emphasis", children: [{ type: "text", value: "duel.in" }] },
        { type: "text", value: " 读入。" },
      ],
    },
    {
      type: "paragraph",
      children: [
        { type: "text", value: "见 " },
        { type: "inline-code", value: "down/graph/" },
        { type: "text", value: "。" },
      ],
    },
    {
      type: "table",
      style: "tuack",
      headers: [
        [{ type: "text", value: "子任务" }],
        [{ type: "inline-code", value: "n" }],
      ],
      rows: [
        [
          [{ type: "text", value: "1" }],
          [{ type: "text", value: "11" }],
          [{ type: "text", value: "任意时刻都没有简单环" }],
        ],
        [[{ type: "text", value: "12" }], [{ type: "text", value: "紧" }]],
      ],
      spans: [
        [
          { colspan: 2, rowspan: 1 },
          { colspan: 1, rowspan: 1 },
        ],
        [
          { colspan: 1, rowspan: 2 },
          { colspan: 1, rowspan: 1 },
          { colspan: 1, rowspan: 1 },
        ],
        [
          { colspan: 1, rowspan: 1 },
          { colspan: 1, rowspan: 1 },
        ],
      ],
    },
    {
      type: "paragraph",
      children: [{ type: "text", value: "高橋王国の構造" }],
    },
    {
      type: "code",
      value: "N\nA_1, 1 A_1, N",
      lines: [
        [{ type: "inline-math", value: "N" }],
        [
          { type: "inline-math", value: "A_{1, 1}" },
          { type: "text", value: " " },
          { type: "inline-math", value: "A_{1, N}" },
        ],
      ],
    },
    {
      type: "sample",
      input: { type: "code", value: "5\n1 2 3 1 2" },
      output: { type: "code", value: "2" },
    },
  ],
  markdown: "",
  assets: [],
  warnings: [],
};

describe("typst statement compile", () => {
  it("compiles a Chinese statement with math, emphasis, and a numbered sample", async () => {
    const view = globalThis as { window?: unknown; document?: unknown };
    view.window ??= globalThis;
    view.document ??= { documentElement: { lang: "zh" } };
    const typst = (await import("@myriaddreamin/typst-all-in-one.ts")) as {
      $typst: {
        use: (...providers: unknown[]) => void;
        mapShadow: (path: string, data: Uint8Array) => Promise<void>;
        pdf: (options: { mainContent: string }) => Promise<Uint8Array>;
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
    const source = problemDocumentToTypst(statement);
    expect(source.indexOf("#set text(")).toBeLessThan(
      source.indexOf("#set page("),
    );
    expect(source).toContain("#text(size: 10pt, font:");
    expect(source).not.toContain("#set text(size: 10pt");
    expect(source).toContain("align(center, it.body)");
    expect(source).not.toContain("align(center, h(2em)");
    const pdf = await typst.$typst.pdf({
      mainContent: source,
    });
    expect(pdf.byteLength).toBeGreaterThan(5_000);
    expect(Buffer.from(pdf.subarray(0, 5)).toString("utf8")).toBe("%PDF-");
    const embedded = Buffer.from(pdf).toString("latin1");
    expect(embedded).toContain("LMRoman12-Regular");
    expect(embedded).toContain("LMRoman10-Regular");
    expect(embedded).toContain("LMRoman10-BoldItalic");
    expect(embedded).toContain("NewCMMath-Book");
    expect(embedded).not.toContain("NewCMMath-Regular");
  }, 60_000);
});
