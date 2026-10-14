import { describe, expect, it } from "vitest";
import type {
  InlineNode,
  StatementBlock,
} from "../../../src/problem/statement";
import { statementBlocksToTypst } from "../../../src/problem/render/statement-to-typst";

const inlineNodes: readonly InlineNode[] = [
  { type: "text", value: "cost $5 and $n$" },
  { type: "strong", children: [{ type: "text", value: "bold" }] },
  { type: "emphasis", children: [{ type: "text", value: "em" }] },
  {
    type: "link",
    url: "https://example.test",
    children: [{ type: "text", value: "link" }],
  },
  { type: "inline-code", value: "code" },
  { type: "inline-math", value: "n^2" },
  { type: "image-inline", url: "https://example.test/a.png", alt: "图" },
  { type: "break" },
];

const blocks: readonly StatementBlock[] = [
  { type: "heading", level: 2, children: [{ type: "text", value: "标题" }] },
  { type: "paragraph", children: inlineNodes },
  { type: "math", value: "a+b" },
  { type: "code", value: "1 2", language: "text" },
  {
    type: "sample",
    input: { type: "code", value: "1" },
    output: { type: "code", value: "2" },
    explanation: [{ type: "text", value: "说明" }],
  },
  {
    type: "list",
    ordered: false,
    items: [
      {
        children: [
          { type: "paragraph", children: [{ type: "text", value: "项" }] },
        ],
      },
    ],
  },
  {
    type: "table",
    headers: [[{ type: "text", value: "列" }]],
    rows: [[[{ type: "text", value: "值" }]]],
    alignments: ["left"],
  },
  { type: "image", url: "https://example.test/a.png", alt: "图" },
  {
    type: "quote",
    blocks: [
      { type: "paragraph", children: [{ type: "text", value: "引用" }] },
    ],
  },
  {
    type: "align",
    align: "center",
    blocks: [{ type: "paragraph", children: [{ type: "text", value: "中" }] }],
  },
  {
    type: "figure",
    caption: "图注",
    blocks: [
      { type: "paragraph", children: [{ type: "text", value: "图内" }] },
    ],
  },
  { type: "thematic-break" },
];

describe("typst statement coverage", () => {
  it("renders every statement block and inline node without rescanning text math", () => {
    const source = statementBlocksToTypst(blocks);
    expect(source.trim().length).toBeGreaterThan(0);
    expect(blocks.length).toBeGreaterThan(0);
    expect(source).toContain('#mi(block: false, "n^2")');
    expect(source).toContain("\\$n\\$");
    expect(source).not.toContain('#mi(block: false, "n")');
  });
});
