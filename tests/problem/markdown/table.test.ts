import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../../src/problem/markdown/serialize";
import { blockHtml } from "../../../src/problem/markdown/html-encode";
import { markdownBlocksToTypst } from "../../../src/problem/render/markdown-to-typst";
import { convertSourceToCnoi } from "../../../src/problem/cnoi/convert";
import {
  parseProblemMarkdown,
  readProblemMarkdown,
} from "../../../src/problem/problem-markdown";
import { luoguProblemAdapter } from "../../../src/problem/adapters/luogu";
import { createSnapshot } from "../snapshot-fixtures";
import type { TableBlock } from "../../../src/problem/markdown/ast";
import { htmlToAst } from "../../../src/problem/markdown/html";

const source = readFileSync(
  new URL(
    "../fixtures/source-markdown/luogu/p5665-table.source.md",
    import.meta.url,
  ),
  "utf8",
).replaceAll("\r\n", "\n");
const expected = readFileSync(
  new URL(
    "../fixtures/source-markdown/luogu/p5665-table.expected.md",
    import.meta.url,
  ),
  "utf8",
).replaceAll("\r\n", "\n");
const tableFrom = (markdown: string): TableBlock => {
  const table = parseMarkdown(markdown).ast.children[0];
  if (table?.type !== "table") throw new Error("Expected table");
  return table;
};
const roundtrip = (table: TableBlock) =>
  expect(tableFrom(serializeMarkdown([table]))).toEqual(table);

describe("editable Markdown tables", () => {
  it("expands physical HTML row/column spans at their actual positions before Markdown encoding", () => {
    const nodes = htmlToAst(
      '<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td>left</td><td rowspan="2" colspan="2">$x_i$</td></tr><tr><td>below</td></tr></tbody></table>',
      "https://example.org",
    ).blocks;
    const table = nodes[0];
    if (table?.type !== "table") throw new Error("Expected table");
    expect(table.rows.map((row) => row.length)).toEqual([3, 3]);
    expect(table.spans?.[1]).toEqual([
      { colspan: 1, rowspan: 1 },
      { colspan: 2, rowspan: 2 },
      null,
    ]);
    expect(table.spans?.[2]).toEqual([{ colspan: 1, rowspan: 1 }, null, null]);
    const markdown = serializeMarkdown(nodes);
    expect(markdown).not.toContain("<table");
    expect(markdown).toContain("| left | $x_i$ | < |");
    expect(markdown).toContain("| below | ^ | ^ |");
    expect(parseMarkdown(markdown).ast.children).toEqual(nodes);
  });

  it("counts expanded covered cells against the table budget", () => {
    expect(() =>
      htmlToAst(
        '<table><tr><th rowspan="101" colspan="101">large</th></tr>' +
          "<tr></tr>".repeat(100) +
          "</table>",
        "https://example.org",
      ),
    ).toThrow("cell budget");
  });
  it("uses pipe tables for ordinary text, TeX and aligned columns", () => {
    const table = tableFrom(
      "| Name | $n$ |\n| :--- | ---: |\n| A | $10^3$ |\n",
    );
    const serialized = serializeMarkdown([table]);
    expect(serialized).not.toMatch(/<table|<span/);
    expect(serialized).toContain("$10^3$");
    roundtrip(table);
  });

  it("roundtrips P5665's native Markdown and its five-row merged cell", () => {
    const table = tableFrom(source);
    expect(table.style).toBe("tuack");
    expect(table.spans?.[1]?.[3]).toEqual({ rowspan: 5, colspan: 1 });
    expect(table.spans?.[5]?.[3]).toBeNull();
    expect(serializeMarkdown([table]).trim()).toBe(expected.trim());
    expect(serializeMarkdown([table])).not.toMatch(/<table|<span|data-ojtrace/);
    roundtrip(table);
  });

  it("keeps the same layout as the former controlled HTML representation", () => {
    const table = tableFrom(source);
    const before = parseMarkdown(blockHtml(table)).ast.children;
    const after = parseMarkdown(serializeMarkdown([table])).ast.children;
    expect(after).toEqual(before);
    expect(markdownBlocksToTypst(after)).toBe(markdownBlocksToTypst(before));
  });

  it("converts a fixed Source fixture without an Adapter or semantic table pass", () => {
    const converted = convertSourceToCnoi({
      metadata: {
        oj: "luogu",
        problemId: "P5665",
        title: "划分",
        originalUrl: "https://www.luogu.com.cn/problem/P5665",
        language: "zh",
      },
      sourceMarkdown: `## 题目描述\n\n${source}`,
      assets: [],
      warnings: [],
    });
    if (!converted.ok) throw new Error(converted.message);
    const read = readProblemMarkdown(converted.value.cnoiMarkdown);
    if (!read.ok) throw new Error(read.message);
    expect(read.value.body.trim()).toBe(`## 题目描述\n\n${expected.trim()}`);
    const parsed = parseProblemMarkdown(
      converted.value.cnoiMarkdown,
      converted.value,
    );
    if (!parsed.ok) throw new Error(parsed.message);
    expect(
      parsed.value.ast.children.find((block) => block.type === "table"),
    ).toEqual(tableFrom(source));
  });

  it("preserves native Source, and lets the editor change table values independently", async () => {
    const native = JSON.parse(
      readFileSync(
        new URL("../fixtures/luogu-p5665-math.json", import.meta.url),
        "utf8",
      ),
    );
    const extracted = await luoguProblemAdapter.extractSource(
      createSnapshot({
        url: "https://www.luogu.com.cn/problem/P5665",
        html: "<main><h1>P5665 划分</h1></main>",
        sourceData: { luoguProblem: native.data.problem },
      }),
    );
    if (!extracted.ok) throw new Error(extracted.message ?? extracted.reason);
    expect(extracted.source.sourceMarkdown).toContain(source.trim());
    expect(extracted.source.sourceMarkdown).not.toContain("<table");
    const converted = convertSourceToCnoi(extracted.source);
    if (!converted.ok) throw new Error(converted.message);
    expect(converted.value.cnoiMarkdown).not.toContain("<table");
    const edited = converted.value.cnoiMarkdown.replace("$10^3$", "$10^8$");
    const parsed = parseProblemMarkdown(edited, converted.value);
    if (!parsed.ok) throw new Error(parsed.message);
    const table = parsed.value.ast.children.find(
      (block) => block.type === "table",
    );
    expect(table?.rows[1]?.[2]).toEqual([
      { type: "inline-math", value: "10^8" },
    ]);
    expect(table?.spans?.[1]?.[3]).toEqual({ rowspan: 5, colspan: 1 });
    expect(extracted.source.sourceMarkdown).toContain("$10^3$");
    expect(converted.value.cnoiMarkdown).toContain("$10^3$");
  });

  it("supports rectangular row and column merges together", () => {
    const table = tableFrom(
      "| A | < | C |\n| --- | --- | --- |\n| ^ | ^ | D |\n",
    );
    expect(table.spans?.[0]?.[0]).toEqual({ rowspan: 2, colspan: 2 });
    expect(table.spans?.[0]?.[1]).toBeNull();
    expect(table.rows[0]?.[0]).toEqual([]);
    roundtrip(table);
  });

  it("retains escaped markers and inline code as cell contents", () => {
    const table = tableFrom(
      "| A | B | C |\n| --- | --- | --- |\n| \\^ | \\< | `^` |\n",
    );
    expect(table.spans).toBeUndefined();
    expect(serializeMarkdown([table])).toContain("\\^");
    roundtrip(table);
  });

  it("keeps all text when markers describe an invalid nonrectangular cell", () => {
    const table = tableFrom("| A | B |\n| --- | --- |\n| x | y |\n| ^ | < |\n");
    expect(table.spans).toBeUndefined();
    expect(table.rows[0]?.[1]).toEqual([{ type: "text", value: "y" }]);
    roundtrip(table);
  });

  it.each(["::cute-table{other}", "::cute-table{tuack}"])(
    "preserves an unused directive: %s",
    (directive) => {
      const ast = parseMarkdown(directive).ast;
      expect(ast.children[0]?.type).toBe("paragraph");
      expect(parseMarkdown(serializeMarkdown(ast.children)).ast).toEqual(ast);
    },
  );

  it("keeps a literal escaped style directive before an ordinary table", () => {
    const ast = parseMarkdown(
      "\\::cute-table{tuack}\n\n| A |\n| --- |\n| B |\n",
    ).ast;
    expect(ast.children).toHaveLength(2);
    expect(ast.children[1]).not.toHaveProperty("style");
    expect(parseMarkdown(serializeMarkdown(ast.children)).ast).toEqual(ast);
  });

  it("retains HTML for headerless irregular grids", () => {
    const ast = parseMarkdown(
      "<table><tr><td>A</td></tr><tr><td>B</td><td>C</td></tr></table>",
    ).ast;
    expect(serializeMarkdown(ast.children)).toContain("<table");
    expect(parseMarkdown(serializeMarkdown(ast.children)).ast).toEqual(ast);
  });

  it("applies the existing span budget to Markdown markers", () => {
    expect(() =>
      parseMarkdown("| A |\n| --- |\n" + "| ^ |\n".repeat(256)),
    ).toThrow("span budget");
  });
});
