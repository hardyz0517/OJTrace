import { describe, expect, it } from "vitest";
import { htmlToStatement } from "../../../src/problem/extract/html-to-statement";
import { markdownToHtml } from "../../../src/problem/extract/markdown-to-html";
import { statementBlocksToTypst } from "../../../src/problem/render/statement-to-typst";
import type { StatementBlock } from "../../../src/problem/statement";

function blocksFrom(markdown: string): StatementBlock[] {
  return [
    ...htmlToStatement(markdownToHtml(markdown), "https://www.luogu.com.cn/")
      .blocks,
  ];
}

describe("Luogu statement directives", () => {
  it("styles the next table as tuack and merges caret cells", () => {
    const blocks = blocksFrom(`::cute-table{tuack}

| 测试点 | $n$ | $r_i$ | 特殊性质 |
| :-: | :-: | :-: | :-: |
| $1 \\sim 4$ | $\\le 10$ | $\\le 10^5$ | 无特殊性质 |
| $5 \\sim 10$ | $\\le 10^5$ | $\\le 2$ | ^ |
| $11 \\sim 15$ | $\\le 30$ | $\\le 10^5$ | 特殊性质 A |
| $16 \\sim 20$ | $\\le 10^5$ | ^ | 无特殊性质 |
`);
    expect(JSON.stringify(blocks)).not.toContain("::cute-table");
    const table = blocks.find((block) => block.type === "table");
    expect(table).toMatchObject({ type: "table", style: "tuack" });
    if (table?.type !== "table") return;
    expect(table.spans?.[1]?.[3]).toEqual({ colspan: 1, rowspan: 2 });
    expect(table.spans?.[2]?.[3]).toBeNull();
    expect(table.spans?.[3]?.[2]).toEqual({ colspan: 1, rowspan: 2 });
    expect(table.spans?.[4]?.[2]).toBeNull();

    const typst = statementBlocksToTypst(blocks);
    expect(typst).toContain(
      "#figure(table(columns: 4, align: (center + horizon, center + horizon, center + horizon, center + horizon)",
    );
    expect(typst).not.toContain("stroke: none");
    expect(typst).not.toContain("table.hline");
    expect(typst).not.toContain("table.vline");
    expect(typst).not.toContain("1fr");
    expect(typst).toContain("rowspan: 2");
    expect(typst).not.toContain("::cute-table");
    expect(typst).not.toMatch(/\[\s*\^\s*\]/);
  });

  it("merges a leftward angle cell without changing a normal table into tuack", () => {
    const blocks = blocksFrom(`| 标题 | 值 |
| --- | --- |
| 合并 | < |
| 下一行 | 保持 |
`);
    const table = blocks[0];
    expect(table).toMatchObject({ type: "table" });
    if (table?.type !== "table") return;
    expect(table.style).toBeUndefined();
    expect(table.spans?.[1]?.[0]).toEqual({ colspan: 2, rowspan: 1 });
    expect(table.spans?.[1]?.[1]).toBeNull();
    expect(statementBlocksToTypst([table])).toContain("colspan: 2");
    expect(statementBlocksToTypst([table])).toContain(
      "#figure(table(columns: 2",
    );
    expect(statementBlocksToTypst([table])).not.toContain("table.header");
  });

  it("consumes align and callout fences instead of printing them", () => {
    const blocks = blocksFrom(`:::align{center}

居中 $x$

:::

:::warning[注意]{open}

小心

:::
`);
    expect(blocks[0]).toMatchObject({ type: "align", align: "center" });
    expect(blocks[1]).toMatchObject({ type: "quote" });
    const rendered = JSON.stringify(blocks);
    expect(rendered).not.toContain(":::");
    expect(rendered).toContain("注意");
    expect(rendered).toContain("小心");
    expect(statementBlocksToTypst(blocks)).toContain("#align(center)");
  });

  it("does not treat a directive mentioned in a sentence as a marker", () => {
    const blocks = blocksFrom(
      "正文里提到 ::cute-table{tuack} 但不是单独一行。",
    );
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    if (blocks[0]?.type !== "paragraph") return;
    expect(
      blocks[0].children
        .map((node) => ("value" in node ? node.value : ""))
        .join(""),
    ).toContain("::cute-table{tuack}");
  });

  it("preserves markdown column alignment", () => {
    const blocks = blocksFrom(`| left | mid | right |
|:---|:---:|---:|
| a | b | c |
`);
    const table = blocks[0];
    expect(table).toMatchObject({
      type: "table",
      alignments: ["left", "center", "right"],
    });
    expect(statementBlocksToTypst(blocks)).toContain(
      "align: (left + horizon, center + horizon, right + horizon)",
    );
  });

  it("wraps a figure directive and keeps its caption", () => {
    const blocks = blocksFrom(`:::figure{caption="示意图"}

![图](https://cdn.example.test/a.png)

:::
`);
    expect(blocks[0]).toMatchObject({
      type: "figure",
      caption: "示意图",
    });
    const typst = statementBlocksToTypst(blocks);
    expect(typst).toContain('#figure(caption: "示意图", )[');
    expect(typst).not.toContain(":::figure");
  });
});
