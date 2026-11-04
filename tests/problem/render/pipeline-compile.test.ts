import { parseMarkdown } from "../../../src/problem/markdown/parse";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  BrowserTypstCompiler,
  bundledPreviewPackages,
} from "../../../src/problem/render/browser-typst-compiler";
import { bundledFontPaths } from "../../../src/problem/render/font-manifest";
import { MITEX_PACKAGE_KEY } from "../../../src/problem/render/code-theme";
import { TypstProblemRenderer } from "../../../src/problem/render/typst-renderer";
import { problemDocumentToTypst } from "../../../src/problem/render/template";
import { serializeMarkdown } from "../../../src/problem/markdown/serialize";
import type { RenderDocument } from "../../../src/problem/domain";
import { fidelityBlocks } from "../fidelity-fixture";
import { problemLabels } from "../../../src/problem/localization";
import { cnoiFixture } from "../source-test-helpers";
import { parseProblemMarkdown } from "../../../src/problem/problem-markdown";
import { luoguProblemAdapter } from "../../../src/problem/adapters/luogu";
import { atcoderProblemAdapter } from "../../../src/problem/adapters/atcoder";
import { hydrojProblemAdapter } from "../../../src/problem/adapters/hydroj";
import { qojProblemAdapter } from "../../../src/problem/adapters/qoj";
import { atcoderFixture } from "../atcoder-fixture";
import { convertSourceToCnoi } from "../../../src/problem/cnoi/convert";
import { createSnapshot } from "../snapshot-fixtures";

it("compiles the same rich document before and after the production Markdown codec", async () => {
  const view = globalThis as { window?: unknown; document?: unknown };
  view.window ??= globalThis;
  view.document ??= { documentElement: { lang: "zh" } };
  const module =
    (await import("@myriaddreamin/typst-all-in-one.ts")) as unknown as {
      $typst: NonNullable<
        ConstructorParameters<typeof BrowserTypstCompiler>[0]
      >;
      TypstSnippet: Parameters<typeof bundledPreviewPackages>[0] & {
        disableDefaultFontAssets(): unknown;
        preloadFonts(fonts: readonly Uint8Array[]): unknown;
      };
    };
  const api = module.$typst as unknown as NonNullable<
    ConstructorParameters<typeof BrowserTypstCompiler>[0]
  >;
  api.use(
    module.TypstSnippet.disableDefaultFontAssets(),
    module.TypstSnippet.preloadFonts(
      bundledFontPaths.map(
        (path) =>
          new Uint8Array(readFileSync(resolve("public", path.slice(1)))),
      ),
    ),
    ...bundledPreviewPackages(
      module.TypstSnippet,
      new Map([
        [
          MITEX_PACKAGE_KEY,
          new Uint8Array(
            readFileSync("public/problem-packages/mitex-0.2.5.tar.gz"),
          ),
        ],
      ]),
    ),
  );
  const original: RenderDocument = {
    oj: "luogu",
    problemId: "Fidelity",
    title: "转换保真验收",
    originalUrl: "https://example.org/p/1",
    language: "zh",
    timeLimit: { display: "1 s" },
    memoryLimit: { display: "128 MB" },
    ast: { type: "root" as const, children: fidelityBlocks },

    assets: ["image.png", "small.png"].map((name) => ({
      sourceUrl: `https://example.org/${name}`,
      mimeType: "image/svg+xml",
      dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="#c7def5"/><circle cx="120" cy="50" r="30" fill="#336699"/></svg>').toString("base64")}`,
    })),
    warnings: [],
  };
  const parsed = {
    ...original,
    ast: {
      type: "root" as const,
      children: parseMarkdown(serializeMarkdown(original.ast.children), {
        baseUrl: original.originalUrl,
      }).ast.children,
    },
  };
  original.displayLabels = problemLabels("zh");
  parsed.displayLabels = original.displayLabels;
  expect(problemDocumentToTypst(parsed)).toBe(problemDocumentToTypst(original));
  const cnoi = cnoiFixture(original);
  const applied = parseProblemMarkdown(cnoi.cnoiMarkdown, cnoi);
  if (!applied.ok) throw new Error(applied.message);
  expect(applied.value.ast.children).toEqual(original.ast.children);
  expect(problemDocumentToTypst(applied.value)).toBe(
    problemDocumentToTypst(original),
  );
  const renderer = new TypstProblemRenderer(new BrowserTypstCompiler(api));
  const before = await renderer.preview(original);
  const after = await renderer.preview(parsed);
  expect(after).toBe(before);
  expect(await renderer.preview(applied.value)).toBe(before);
  const pdf = await renderer.render(applied.value);
  expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
  expect(pdf.byteLength).toBeGreaterThan(5000);

  const native = JSON.parse(
    readFileSync("tests/problem/fixtures/luogu-p5665-math.json", "utf8"),
  );
  const extraction = await luoguProblemAdapter.extractSource(
    createSnapshot({
      url: "https://www.luogu.com.cn/problem/P5665",
      title: "P5665 [CSP-S 2019] 划分",
      html: "<main><h1>P5665 [CSP-S 2019] 划分</h1></main>",
      sourceData: { luoguProblem: native.data.problem },
    }),
  );
  if (!extraction.ok) throw new Error(extraction.reason);
  const mathCnoi = convertSourceToCnoi(extraction.source);
  if (!mathCnoi.ok) throw new Error(mathCnoi.message);
  const mathDocument = parseProblemMarkdown(
    mathCnoi.value.cnoiMarkdown,
    mathCnoi.value,
  );
  if (!mathDocument.ok) throw new Error(mathDocument.message);
  const equations = mathDocument.value.ast.children.filter(
    (block) => block.type === "math",
  );
  expect(equations).toHaveLength(3);
  expect(equations[0]?.value).toContain(String.raw`\sum_{i=1}^{k_1} a_i`);
  expect(equations[1]?.value).toContain(
    String.raw`\left(\sum_{i=k_p+1}^{n} a_i\right)^2`,
  );
  expect(mathCnoi.value.cnoiMarkdown).not.toContain("Σ");
  expect(extraction.source.sourceMarkdown).not.toContain("<table");
  expect(mathCnoi.value.cnoiMarkdown).not.toContain("<table");
  expect(mathCnoi.value.cnoiMarkdown).toContain("::cute-table{tuack}");
  const table = mathDocument.value.ast.children.find(
    (block) => block.type === "table",
  );
  expect(table?.spans?.[1]?.[3]).toEqual({ rowspan: 5, colspan: 1 });
  const mathSvg = await renderer.preview(mathDocument.value);
  const mathPdf = await renderer.render(mathDocument.value);
  expect(Buffer.from(mathPdf.subarray(0, 5)).toString()).toBe("%PDF-");
  expect(mathPdf.byteLength).toBeGreaterThan(5000);
  // The readable math fence must reach the existing renderer as math lines,
  // not as a literal code language or a second semantic conversion.
  for (const language of ["en", "ja"] as const) {
    const source = await atcoderProblemAdapter.extractSource(
      createSnapshot({
        url: `https://atcoder.jp/contests/abc391/tasks/abc391_g?lang=${language}`,
        html: atcoderFixture({ language, rendered: true, copyControls: true }),
      }),
    );
    if (!source.ok) throw new Error(source.reason);
    const converted = convertSourceToCnoi(source.source);
    if (!converted.ok) throw new Error(converted.message);
    const direct = parseProblemMarkdown(
      converted.value.cnoiMarkdown,
      converted.value,
    );
    if (!direct.ok) throw new Error(direct.message);
    expect(
      direct.value.ast.children.filter(
        (node) => node.type === "code" && node.lines,
      ),
    ).toHaveLength(2);
    const editor = parseProblemMarkdown(
      String(converted.value.cnoiMarkdown),
      converted.value,
    );
    if (!editor.ok) throw new Error(editor.message);
    expect(problemDocumentToTypst(editor.value)).toBe(
      problemDocumentToTypst(direct.value),
    );
    const svg = await renderer.preview(direct.value);
    expect(await renderer.preview(editor.value)).toBe(svg);
    const pdf = await renderer.render(editor.value);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    const edited = parseProblemMarkdown(
      converted.value.cnoiMarkdown.replace("$N$ $M$", "$N^2$ $M$") +
        "\nUser-added explanation.\n",
      converted.value,
    );
    if (!edited.ok) throw new Error(edited.message);
    expect(problemDocumentToTypst(edited.value)).toContain('"N^2"');
    expect(await renderer.preview(edited.value)).not.toBe(svg);
    if (process.env.OJTRACE_QA_DIR) {
      mkdirSync(process.env.OJTRACE_QA_DIR, { recursive: true });
      writeFileSync(
        resolve(process.env.OJTRACE_QA_DIR, `atcoder-abc391-g.${language}.pdf`),
        pdf,
      );
      writeFileSync(
        resolve(process.env.OJTRACE_QA_DIR, `atcoder-abc391-g.${language}.svg`),
        svg,
      );
      writeFileSync(
        resolve(
          process.env.OJTRACE_QA_DIR,
          `atcoder-abc391-g.${language}.cnoi.md`,
        ),
        converted.value.cnoiMarkdown,
      );
    }
  }
  const hydroSource = await hydrojProblemAdapter.extractSource(
    createSnapshot({
      url: "http://47.113.203.55/p/100",
      html: readFileSync("docs/fixtures/problem/hydroj-tree.html", "utf8"),
    }),
  );
  if (!hydroSource.ok) throw new Error(hydroSource.reason);
  const hydro = convertSourceToCnoi(hydroSource.source);
  if (!hydro.ok) throw new Error(hydro.message);
  const hydroDocument = parseProblemMarkdown(
    hydro.value.cnoiMarkdown,
    hydro.value,
  );
  if (!hydroDocument.ok) throw new Error(hydroDocument.message);
  const hydroEditor = parseProblemMarkdown(
    String(hydro.value.cnoiMarkdown),
    hydro.value,
  );
  if (!hydroEditor.ok) throw new Error(hydroEditor.message);
  expect(problemDocumentToTypst(hydroEditor.value)).toBe(
    problemDocumentToTypst(hydroDocument.value),
  );
  const hydroSvg = await renderer.preview(hydroDocument.value);
  expect(await renderer.preview(hydroEditor.value)).toBe(hydroSvg);
  const hydroPdf = await renderer.render(hydroEditor.value);
  expect(Buffer.from(hydroPdf.subarray(0, 5)).toString()).toBe("%PDF-");
  const hydroEdited = parseProblemMarkdown(
    hydro.value.cnoiMarkdown.replace("无特殊性质", "用户修改的性质"),
    hydro.value,
  );
  if (!hydroEdited.ok) throw new Error(hydroEdited.message);
  expect(problemDocumentToTypst(hydroEdited.value)).toContain("用户修改的性质");
  expect(await renderer.preview(hydroEdited.value)).not.toBe(hydroSvg);
  expect(hydroSource.source.sourceMarkdown).not.toContain("用户修改的性质");
  if (process.env.OJTRACE_QA_DIR) {
    mkdirSync(process.env.OJTRACE_QA_DIR, { recursive: true });
    writeFileSync(
      resolve(process.env.OJTRACE_QA_DIR, "hydroj-tree.pdf"),
      hydroPdf,
    );
    writeFileSync(
      resolve(process.env.OJTRACE_QA_DIR, "hydroj-tree.svg"),
      hydroSvg,
    );
    writeFileSync(
      resolve(process.env.OJTRACE_QA_DIR, "hydroj-tree.cnoi.md"),
      hydro.value.cnoiMarkdown,
    );
  }
  const qojSource = await qojProblemAdapter.extractSource(
    createSnapshot({
      url: "https://qoj.ac/problem/1907",
      html: readFileSync("docs/fixtures/problem/qoj-1907.html", "utf8"),
    }),
  );
  if (!qojSource.ok) throw new Error(qojSource.reason);
  const qojOriginal = JSON.stringify(qojSource.source);
  const qoj = convertSourceToCnoi(qojSource.source);
  if (!qoj.ok) throw new Error(qoj.message);
  const qojDocument = parseProblemMarkdown(qoj.value.cnoiMarkdown, qoj.value);
  if (!qojDocument.ok) throw new Error(qojDocument.message);
  const qojEditor = parseProblemMarkdown(
    String(qoj.value.cnoiMarkdown),
    qoj.value,
  );
  if (!qojEditor.ok) throw new Error(qojEditor.message);
  expect(qojEditor.value).toEqual(qojDocument.value);
  expect(problemDocumentToTypst(qojEditor.value)).toBe(
    problemDocumentToTypst(qojDocument.value),
  );
  const qojSvg = await renderer.preview(qojDocument.value);
  expect(await renderer.preview(qojEditor.value)).toBe(qojSvg);
  const qojPdf = await renderer.render(qojEditor.value);
  expect(Buffer.from(qojPdf.subarray(0, 5)).toString()).toBe("%PDF-");
  const edited =
    qoj.value.cnoiMarkdown
      .replace("## 输入格式", "#### 用户输入格式")
      .replace("## 样例 1 输入", "##### Input #7") +
    "\n###### 用户补充\n\n- 段一。\n\n  段二。\n";
  const qojEdited = parseProblemMarkdown(edited, qoj.value);
  if (!qojEdited.ok) throw new Error(qojEdited.message);
  const editedTypst = problemDocumentToTypst(qojEdited.value);
  expect(editedTypst).toContain("==== 用户输入格式");
  expect(editedTypst).toContain("===== Input \\#7");
  expect(editedTypst).toContain("====== 用户补充");
  expect(editedTypst).toContain("- 段一。\n\n  段二。");
  const qojEditedSvg = await renderer.preview(qojEdited.value);
  expect(qojEditedSvg).not.toBe(qojSvg);
  const qojEditedPdf = await renderer.render(qojEdited.value);
  expect(Buffer.from(qojEditedPdf.subarray(0, 5)).toString()).toBe("%PDF-");
  expect(JSON.stringify(qojSource.source)).toBe(qojOriginal);
  if (process.env.OJTRACE_QA_DIR) {
    for (const [name, content] of [
      ["qoj-1907.pdf", qojPdf],
      ["qoj-1907.svg", qojSvg],
      ["qoj-1907.cnoi.md", qoj.value.cnoiMarkdown],
      ["qoj-1907.edited.pdf", qojEditedPdf],
      ["qoj-1907.edited.svg", qojEditedSvg],
      ["qoj-1907.edited.md", edited],
    ] as const)
      writeFileSync(resolve(process.env.OJTRACE_QA_DIR, name), content);
  }
  if (process.env.OJTRACE_QA_DIR) {
    mkdirSync(process.env.OJTRACE_QA_DIR, { recursive: true });
    writeFileSync(
      resolve(process.env.OJTRACE_QA_DIR, "pipeline-fidelity.pdf"),
      pdf,
    );
    writeFileSync(
      resolve(process.env.OJTRACE_QA_DIR, "pipeline-fidelity.svg"),
      after,
    );
    writeFileSync(
      resolve(process.env.OJTRACE_QA_DIR, "pipeline-cnoi.json"),
      JSON.stringify(cnoi),
    );
    writeFileSync(
      resolve(process.env.OJTRACE_QA_DIR, "luogu-p5665.pdf"),
      mathPdf,
    );
    writeFileSync(
      resolve(process.env.OJTRACE_QA_DIR, "luogu-p5665.svg"),
      mathSvg,
    );
    writeFileSync(
      resolve(process.env.OJTRACE_QA_DIR, "luogu-p5665-cnoi.json"),
      JSON.stringify(mathCnoi.value),
    );
  }
}, 60000);
