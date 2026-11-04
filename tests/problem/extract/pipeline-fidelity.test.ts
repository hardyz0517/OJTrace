import { parseMarkdown } from "../../../src/problem/markdown/parse";
import { readFileSync } from "node:fs";
import type { MarkdownBlock } from "../../../src/problem/markdown/ast";
import { describe, expect, it } from "vitest";
import { htmlToAst } from "../../../src/problem/markdown/html";
import { serializeMarkdown } from "../../../src/problem/markdown/serialize";
import { markdownBlocksToTypst } from "../../../src/problem/render/markdown-to-typst";
import { fidelityBlocks } from "../fidelity-fixture";
import { createSnapshot } from "../snapshot-fixtures";
import { extractRenderedDocument } from "../source-test-helpers";
import {
  parseProblemMarkdown,
  serializeProblemMarkdown,
} from "../../../src/problem/problem-markdown";

const url = "https://example.org/p/1";

describe("pipeline fidelity gate", () => {
  it.each([
    ["https://www.luogu.com.cn/problem/P1001", "luogu-current.html"],
    [
      "https://atcoder.jp/contests/abc300/tasks/abc300_a",
      "atcoder-multilang.html",
    ],
    ["https://qoj.ac/problem/1", "qoj-uoj.html"],
  ])(
    "preserves extracted CNOI content and metadata from %s",
    async (url, file) => {
      const html = readFileSync(
        new URL(`../../../docs/fixtures/problem/${file}`, import.meta.url),
        "utf8",
      );
      // A real capture delivers Luogu's native JSON separately before stripping
      // scripts. The rendered-only HTML cannot recover the original TeX.
      const sourceScript = html.match(
        /<script id="lentille-context" type="application\/json">([\s\S]*?)<\/script>/i,
      )?.[1];
      const problem = sourceScript
        ? JSON.parse(sourceScript).data?.problem
        : undefined;
      const document = await extractRenderedDocument(
        createSnapshot({
          url,
          html,
          title: file,
          ...(problem ? { sourceData: { luoguProblem: problem } } : {}),
        }),
      );
      const again = parseMarkdown(serializeMarkdown(document.ast.children), {
        baseUrl: document.originalUrl,
      });
      expect(again.ast.children).toEqual(document.ast.children);
      const edited = parseProblemMarkdown(
        serializeProblemMarkdown(
          document,
          serializeMarkdown(document.ast.children),
        ),
        document,
      );
      if (!edited.ok) throw new Error(edited.message);
      expect(edited.value.ast.children).toEqual(document.ast.children);
      expect(edited.value.title).toBe(document.title);
      expect(edited.value.problemId).toBe(document.problemId);
    },
  );
  it("preserves rich semantics and the exact Typst body through Markdown", () => {
    const markdown = serializeMarkdown(fidelityBlocks);
    const parsed = parseMarkdown(markdown, { baseUrl: url });
    expect(parsed.ast.children).toEqual(fidelityBlocks);
    expect(markdownBlocksToTypst(parsed.ast.children)).toBe(
      markdownBlocksToTypst(fidelityBlocks),
    );
    expect(serializeMarkdown(parsed.ast.children)).toBe(markdown);
  });
  it("does not infer samples from ordinary input formats or headings", () => {
    expect(
      htmlToAst(
        "<h3>Input</h3><pre>N M</pre><h3>Sample Input 1</h3><pre>1</pre>",
        url,
      ).blocks.map((b) => b.type),
    ).toEqual(["heading", "code", "heading", "code"]);
  });
  it("does not generate or renumber sample labels in the renderer", () => {
    const source = markdownBlocksToTypst(fidelityBlocks);
    expect(source).toContain("Sample Input 7");
    expect(source).not.toContain("样例 1");
    expect(source).toContain("Second.");
  });
  it("reports missing math source instead of falling back to old source content", () => {
    expect(() =>
      parseMarkdown('<span class="katex">rendered symbols</span>'),
    ).toThrow("LaTeX 源码");
  });
});

it("preserves literal math-like text, links, breaks, headerless tables and multi-block list items", () => {
  const text = (value: string) => [{ type: "text" as const, value }];
  const blocks: MarkdownBlock[] = [
    { type: "paragraph", children: text("# literal heading") },
    {
      type: "paragraph",
      children: [
        ...text("cost $5 and $n$ &alpha; "),
        { type: "strong", children: text("bold ") },
        ...text("words"),
        { type: "break" },
        ...text("next"),
      ],
    },
    {
      type: "paragraph",
      children: [
        {
          type: "link",
          url: "https://example.org/a(b)",
          children: text("link"),
        },
      ],
    },
    { type: "table", headers: [], rows: [[text("^"), text("<")]] },
    {
      type: "list",
      ordered: true,
      items: [
        {
          children: [
            { type: "paragraph", children: text("first") },
            { type: "paragraph", children: text("second") },
            { type: "code", value: "a" },
          ],
        },
      ],
    },
  ];
  const parsed = parseMarkdown(serializeMarkdown(blocks), { baseUrl: url }).ast
    .children;
  expect(parsed).toEqual(blocks);
  expect(markdownBlocksToTypst(parsed)).toBe(markdownBlocksToTypst(blocks));
});

it("preserves table pipe characters in text, code and formulas", () => {
  const blocks: MarkdownBlock[] = [
    {
      type: "table",
      headers: [[{ type: "inline-code", value: "x|y" }]],
      rows: [
        [[{ type: "inline-math", value: "|a|" }]],
        [[{ type: "text", value: "x|y" }]],
      ],
    },
  ];
  expect(
    parseMarkdown(serializeMarkdown(blocks), { baseUrl: url }).ast.children,
  ).toEqual(blocks);
});

it("bounds nested HTML and table spans before recursive rendering", () => {
  expect(() =>
    htmlToAst("<div>".repeat(150) + "text" + "</div>".repeat(150), url),
  ).toThrow(/depth/);
  expect(() =>
    htmlToAst('<table><tr><td rowspan="999999">x</td></tr></table>', url),
  ).toThrow(/span/);
});
