import { describe, expect, it } from "vitest";
import type { ProblemDocument } from "../../../src/problem/domain";
import { problemDocumentToTypst } from "../../../src/problem/render/template";
import { TypstProblemRenderer } from "../../../src/problem/render/typst-renderer";

const document: ProblemDocument = {
  oj: "codeforces",
  problemId: "1A",
  title: "Theatre Square",
  originalUrl: "https://codeforces.com/problemset/problem/1/A",
  timeLimit: { display: "1 second", milliseconds: 1_000 },
  memoryLimit: { display: "256 megabytes", bytes: 256 * 1024 * 1024 },
  language: "en",
  blocks: [
    {
      type: "heading",
      level: 2,
      children: [{ type: "text", value: "Problem" }],
    },
    {
      type: "paragraph",
      children: [
        { type: "text", value: "Compute " },
        { type: "inline-math", value: "n^2" },
        { type: "text", value: "." },
      ],
    },
    { type: "code", value: "6 6 4", language: "text" },
    {
      type: "sample",
      input: { type: "code", value: "6 6 4", language: "text" },
      output: { type: "code", value: "4", language: "text" },
    },
    {
      type: "table",
      headers: [
        [{ type: "text", value: "变量" }],
        [{ type: "text", value: "范围" }],
      ],
      rows: [
        [
          [{ type: "inline-code", value: "n" }],
          [{ type: "text", value: "1 到 10^9" }],
        ],
      ],
    },
  ],
  markdown: "## Problem\n\nCompute $n^2$.\n",
  assets: [],
  warnings: [],
};

describe("problem renderer", () => {
  it("converts canonical blocks to a self-contained Typst document", () => {
    const source = problemDocumentToTypst(document);
    expect(source).toContain("Theatre Square");
    expect(source).toContain("时间限制");
    expect(source).toContain('#mi(block: false, "n^2")');
    expect(source).toContain("6 6 4");
    expect(source).toContain("#figure(table(columns: 2");
    expect(source).not.toContain("#show raw.where(block: false)");
    expect(source).not.toContain("#show table.cell");
    expect(source).toContain("bottom: 2pt");
    expect(source).toContain("[变量]");
    expect(source).not.toContain("table.header(");
    expect(source).not.toContain("[*变量*]");
    expect(source).not.toContain("[object Object]");
    expect(source).toContain('paper: "a4"');
    expect(source).toContain("第 #(now) 页");
    expect(source).toContain("Codeforces #h(1fr) 1A#h(0.5em)Theatre Square");
    expect(source).toContain("size: 18pt");
    expect(source).toContain("first-line-indent: (amount: 2em, all: true)");
    expect(source).toContain("样例 1 输入");
    expect(source).toContain("样例 1 输出");
    expect(source).toContain('rgb("#0000ff")');
    expect(source).toContain("leading: 0.65em");
    expect(source).toContain("spacing: 0em");
    expect(source).not.toContain("below: 0.65em");
    expect(source).toContain("dx: -9pt - measure([#jt.number]).width");
    expect(source).not.toContain("columns: (2.1em, 1fr)");
    expect(source).toContain("New Computer Modern Math");
    expect(source).not.toContain("=== 样例");
    expect(source).not.toContain(document.originalUrl);
  });

  it("escapes Typst markup characters in untrusted statement text", () => {
    const untrustedDocument: ProblemDocument = {
      ...document,
      title: "#let(x) *title* [label]",
      blocks: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value: "// #show raw: *bold* _em_ cost $5 <label> @ref `code`",
            },
          ],
        },
      ],
    };
    const source = problemDocumentToTypst(untrustedDocument);

    expect(source).toContain("\\#let(x) \\*title\\* \\[label\\]");
    expect(source).toContain(
      String.raw`\/\/ \#show raw: \*bold\* \_em\_ cost \$5 \<label\> \@ref \`code\``,
    );
    expect(source).not.toContain("#show raw: *bold*");
  });

  it("normalizes common LaTeX formula commands for Typst", () => {
    const formulaDocument: ProblemDocument = {
      ...document,
      blocks: [
        {
          type: "paragraph",
          children: [
            { type: "inline-math", value: String.raw`\frac{a}{b} \le c` },
          ],
        },
        { type: "math", value: String.raw`\sqrt{x}` },
      ],
    };
    const source = problemDocumentToTypst(formulaDocument);
    expect(source).toContain(
      String.raw`#mi(block: false, "\\frac{a}{b} \\le c")`,
    );
    expect(source).toContain(String.raw`#mi(block: true, "\\sqrt{x}")`);
    expect(source).not.toContain("$frac");
  });

  it("preserves display math embedded in paragraph content", () => {
    const formulaDocument: ProblemDocument = {
      ...document,
      blocks: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "The result is " },
            {
              type: "inline-math",
              value: String.raw`\sum_{i=1}^n i`,
              display: true,
            },
            { type: "text", value: "." },
          ],
        },
      ],
    };

    const source = problemDocumentToTypst(formulaDocument);

    expect(source).toContain(String.raw`#mi(block: true, "\\sum_{i=1}^n i")`);
  });

  it("converts nested radicals and fractions while keeping Typst code inert", () => {
    const formulaDocument: ProblemDocument = {
      ...document,
      blocks: [
        {
          type: "paragraph",
          children: [
            {
              type: "inline-math",
              value: String.raw`\frac{\sqrt{x+1}}{y} #let(a=1)`,
            },
          ],
        },
      ],
    };
    const source = problemDocumentToTypst(formulaDocument);

    expect(source).toContain(
      String.raw`#mi(block: false, "\\frac{\\sqrt{x+1}}{y} #let(a=1)")`,
    );
    expect(source).not.toMatch(/\n#let\(a=1\)/);
  });

  it("counts merged table columns by span instead of cell count", () => {
    const source = problemDocumentToTypst({
      ...document,
      blocks: [
        {
          type: "table",
          headers: [
            [{ type: "text", value: "Group" }],
            [{ type: "text", value: "Limit" }],
          ],
          rows: [
            [
              [{ type: "text", value: "1" }],
              [{ type: "text", value: "11" }],
              [{ type: "inline-code", value: "n" }],
            ],
            [
              [{ type: "text", value: "12" }],
              [{ type: "text", value: "tight" }],
            ],
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
      ],
    });
    expect(source).toContain("#figure(table(columns: 3");
    expect(source).toContain("table.cell(colspan: 2)[Group]");
    expect(source).toContain("table.cell(rowspan: 2)[1]");
    expect(source).toContain('#raw("n", lang: "txt", block: false)');
  });

  it("keeps the compiler injectable", async () => {
    let source = "";
    const renderer = new TypstProblemRenderer({
      compile: async (next) => {
        source = next;
        return new Uint8Array([37, 80, 68, 70]);
      },
    });
    await expect(renderer.render(document)).resolves.toEqual(
      new Uint8Array([37, 80, 68, 70]),
    );
    expect(source).toContain("Theatre Square");
  });

  it("does not pass unembedded remote images to Typst", () => {
    const imageDocument: ProblemDocument = {
      ...document,
      assets: [],
      blocks: [
        {
          type: "image",
          url: "https://cdn.example.test/diagram.png",
          alt: "图示",
        },
      ],
    };
    const source = problemDocumentToTypst(imageDocument);

    expect(source).not.toContain(
      '#image("https://cdn.example.test/diagram.png"',
    );
    expect(source).toContain('#link("https://cdn.example.test/diagram.png")');
    expect(source).toContain("图示");
    expect(source).toContain("查看原图");
  });

  it("keeps quotes and hashes inside a Typst link string", () => {
    const source = problemDocumentToTypst({
      ...document,
      blocks: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: 'https://cdn.example.test/a"b#c',
              children: [{ type: "text", value: "site" }],
            },
          ],
        },
      ],
    });
    expect(source).toContain('#link("https://cdn.example.test/a\\"b#c")[site]');
  });

  it("maps embedded image bytes to a renderer-owned Typst virtual path", async () => {
    const sourceUrl = "https://cdn.example.test/diagram.png";
    const imageDocument: ProblemDocument = {
      ...document,
      assets: [
        {
          sourceUrl,
          alt: "图示",
          mimeType: "image/png",
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WioAAAAASUVORK5CYII=",
        },
      ],
      blocks: [{ type: "image", url: sourceUrl, alt: "图示" }],
    };
    let compiledSource = "";
    let compiledAssets: ReadonlyMap<string, Uint8Array> | undefined;
    const renderer = new TypstProblemRenderer({
      compile: async (next, options) => {
        compiledSource = next;
        compiledAssets = options?.assets;
        return new Uint8Array([37, 80, 68, 70]);
      },
    });

    await renderer.render(imageDocument);

    expect(compiledSource).toContain(
      '#box(image("/ojtrace-assets/image-0.png", alt: "图示"))',
    );
    expect(compiledSource).not.toContain("align(center, picture)");
    expect(compiledSource).not.toMatch(/image\([^)]*width:/);
    expect(compiledAssets?.has("/ojtrace-assets/image-0.png")).toBe(true);
    expect(
      compiledAssets?.get("/ojtrace-assets/image-0.png")?.byteLength,
    ).toBeGreaterThan(0);
  });

  it("keeps an author-less image at its natural size", async () => {
    const narrowUrl = "https://espresso.codeforces.com/narrow.png";
    const wideUrl = "https://espresso.codeforces.com/wide.png";
    const imageDocument: ProblemDocument = {
      ...document,
      assets: [
        {
          sourceUrl: narrowUrl,
          mimeType: "image/png",
          dataUrl: pngDataUrl(200, 220),
        },
        {
          sourceUrl: wideUrl,
          mimeType: "image/png",
          dataUrl: pngDataUrl(800, 180),
        },
      ],
      blocks: [
        {
          type: "image",
          url: narrowUrl,
          alt: "narrow",
          zoom: 0.75,
          maxWidthRatio: 1,
          maxHeightRatio: 1,
        },
        {
          type: "image",
          url: wideUrl,
          alt: "wide",
          zoom: 0.75,
          maxWidthRatio: 1,
        },
      ],
    };
    let compiledSource = "";
    const renderer = new TypstProblemRenderer({
      compile: async (next) => {
        compiledSource = next;
        return new Uint8Array([37, 80, 68, 70]);
      },
    });

    await renderer.render(imageDocument);

    expect(compiledSource).toContain('alt: "narrow"');
    expect(compiledSource).toContain('alt: "wide"');
    expect(compiledSource).not.toContain("align(center, picture)");
    expect(compiledSource).not.toMatch(/image\([^)]*width:/);
  });

  it("flattens paragraphs inside a list item", () => {
    const source = problemDocumentToTypst({
      ...document,
      blocks: [
        {
          type: "list",
          ordered: false,
          items: [
            {
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "第一句。" }],
                },
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "第二句。" }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(source).toContain("- 第一句。 第二句。");
    expect(source).not.toContain("- 第一句。\n\n第二句。");
  });

  it("maps plain and markdown code languages onto the code theme", () => {
    const source = problemDocumentToTypst({
      ...document,
      blocks: [
        { type: "code", value: "int a = 1;", language: "plain" },
        { type: "code", value: "# title", language: "markdown" },
      ],
    });
    expect(source).toContain('lang: "txt"');
    expect(source).toContain('lang: "md"');
    expect(source).toContain('theme: "/ojtrace/code.tmTheme"');
  });

  it("scales an image only when the statement sets a width", () => {
    const source = problemDocumentToTypst({
      ...document,
      assets: [
        {
          sourceUrl: "https://cdn.example.test/diagram.png",
          mimeType: "image/png",
          dataUrl: pngDataUrl(200, 100),
          typstPath: "/ojtrace-assets/image-0.png",
        },
      ],
      blocks: [
        {
          type: "image",
          url: "https://cdn.example.test/diagram.png",
          alt: "图",
          width: 200,
        },
      ],
    });
    expect(source).toContain(
      '#box(image("/ojtrace-assets/image-0.png", width: 150pt, alt: "图"))',
    );
  });
});

function pngDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[11] = 13;
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}
