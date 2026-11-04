import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../../src/problem/markdown/serialize";
import { fidelityBlocks } from "../fidelity-fixture";
import type { MarkdownBlock } from "../../../src/problem/markdown/ast";

describe("generic Markdown syntax", () => {
  it.each([
    {
      type: "paragraph",
      children: [{ type: "inline-code", value: " leading and trailing " }],
    },
    {
      type: "paragraph",
      children: [{ type: "inline-code", value: "first\nsecond" }],
    },
    {
      type: "paragraph",
      children: [{ type: "inline-math", value: "x+y", display: true }],
    },
    { type: "paragraph", children: [{ type: "inline-math", value: "x+\ny" }] },
    {
      type: "paragraph",
      children: [
        {
          type: "image-inline",
          url: "https://example.org/a.png",
          alt: "inline",
        },
      ],
    },
  ] satisfies MarkdownBlock[])(
    "preserves explicit inline syntax that plain Markdown would normalize: %j",
    (node) => {
      expect(parseMarkdown(serializeMarkdown([node])).ast.children).toEqual([
        node,
      ]);
    },
  );
  it("keeps Input and sample-looking headings as ordinary syntax", () => {
    const parsed = parseMarkdown(
      "## Input\n\nN M\n\n## Examples\n\n### Input\n\n```\n1\n```\n",
    );
    expect(parsed.ast.children.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "heading",
      "code",
    ]);
    expect(parsed.ast.children[3]).toMatchObject({ type: "heading", level: 3 });
  });
  it("roundtrips rich syntax without semantics or layout loss", () => {
    const markdown = serializeMarkdown(fidelityBlocks);
    const parsed = parseMarkdown(markdown);
    expect(parsed.ast.children).toEqual(fidelityBlocks);
    expect(serializeMarkdown(parsed.ast.children)).toBe(markdown);
  });
  it("does not apply webpage chrome filtering to edited HTML", () => {
    expect(
      serializeMarkdown(
        parseMarkdown('<div class="sidebar"><p>Keep me.</p></div>').ast
          .children,
      ),
    ).toContain("Keep me.");
  });
  it("preserves source boundaries using ordinary Markdown headings", () => {
    const parsed = parseMarkdown(
      "## 原始标题\n\n文字 $x_1$.\n\n## 输入格式\n\n格式。\n",
    );
    expect(parsed.ast.children[0]).toMatchObject({
      type: "heading",
      level: 2,
    });
    expect(parseMarkdown(serializeMarkdown(parsed.ast.children)).ast).toEqual(
      parsed.ast,
    );
  });
  it("keeps ordered list starts, nested blocks, strikeout and literal delimiters", () => {
    const parsed = parseMarkdown("7. ~~deleted~~ and `$literal$`\n8. next\n");
    expect(parsed.ast.children[0]).toMatchObject({
      type: "list",
      ordered: true,
      start: 7,
    });
    expect(parseMarkdown(serializeMarkdown(parsed.ast.children)).ast).toEqual(
      parsed.ast,
    );
  });
});
