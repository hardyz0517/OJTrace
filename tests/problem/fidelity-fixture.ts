import type { MarkdownBlock } from "../../src/problem/markdown/ast";
const text = (value: string) => [{ type: "text" as const, value }];
const label = (value: string) => ({
  type: "heading" as const,
  level: 2,
  children: text(value),
});

export const fidelityBlocks: readonly MarkdownBlock[] = [
  label("题目描述"),
  {
    type: "paragraph",
    children: [
      {
        type: "link",
        url: "https://example.org/",
        title: 'A "link"',
        children: text("link"),
      },
      ...text(" and "),
      { type: "inline-math", value: "a_i+b", display: true },
    ],
  },
  {
    type: "image",
    url: "https://example.org/image.png",
    alt: "figure",
    width: 240,
    height: 100,
    zoom: 0.75,
    widthRatio: 0.6,
    maxWidthRatio: 1,
    maxHeightPx: 150,
  },
  { type: "paragraph", caption: true, children: text("图注") },
  {
    type: "paragraph",
    children: [
      ...text("inline "),
      {
        type: "image-inline",
        url: "https://example.org/small.png",
        alt: "small",
        height: 20,
        maxHeightRatio: 1,
      },
    ],
  },
  {
    type: "table",
    style: "tuack",
    headers: [text("A"), text("B")],
    rows: [
      [text("C"), []],
      [text("D"), text("E")],
    ],
    spans: [
      [
        { colspan: 1, rowspan: 1 },
        { colspan: 1, rowspan: 1 },
      ],
      [{ colspan: 2, rowspan: 1 }, null],
      [
        { colspan: 1, rowspan: 1 },
        { colspan: 1, rowspan: 1 },
      ],
    ],
    alignments: ["left", "right"],
  },
  { type: "code", value: "\n  <x>\\n```\n\n", language: "text" },
  {
    type: "code",
    value: "N\nA_1",
    lines: [
      [{ type: "inline-math", value: "N" }],
      [{ type: "inline-math", value: "A_{1}" }],
    ],
  },
  ...([
    label("Sample Input 7"),
    { type: "code", value: "1" },
    label("Sample Output 7"),
    { type: "code", value: "2" },
    label("Explanation"),
    ...([
      { type: "paragraph", children: text("First.") },
      { type: "paragraph", children: text("Second.") },
      {
        type: "list",
        ordered: false,
        items: [
          { children: [{ type: "paragraph", children: text("Third.") }] },
        ],
      },
    ] as const),
  ] as const),
  {
    type: "align",
    align: "right",
    blocks: [
      {
        type: "figure",
        caption: 'A "figure"',
        blocks: [{ type: "math", value: "x^2" }],
      },
    ],
  },
];
