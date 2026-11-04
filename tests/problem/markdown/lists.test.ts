import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../../src/problem/markdown/serialize";
import { htmlToAst } from "../../../src/problem/markdown/html";

describe("editable nested Markdown lists", () => {
  it.each([
    "- Parent $k$:\n  - Nested $w_i$.\n- Next.\n",
    "9. First.\n   - Child.\n10. Second.\n    - Child.\n",
    "- First paragraph.\n\n  Second paragraph.\n\n  ```text\n  a\n  b\n  ```\n\n- Next.\n",
    "- [x] First.\n  - [ ] Child.\n- [ ] Second.\n",
    "- > Quote.\n\n  End.\n",
    "- ## Heading\n\n  Text.\n",
    "-\n  - Nested without a preceding paragraph.\n",
  ])(
    "preserves list hierarchy and content with readable indentation: %s",
    (source) => {
      const ast = parseMarkdown(source).ast;
      const markdown = serializeMarkdown(ast.children);
      expect(markdown).not.toMatch(/<ul|<ol|<li|data-ojtrace-list/);
      expect(parseMarkdown(markdown).ast).toEqual(ast);
      expect(serializeMarkdown(parseMarkdown(markdown).ast.children)).toBe(
        markdown,
      );
    },
  );

  it("keeps distinct adjacent lists instead of joining their items", () => {
    const nodes = htmlToAst(
      "<ul><li>First.</li></ul><ul><li>Second.</li></ul>",
      "https://example.org",
    ).blocks;
    expect(nodes).toHaveLength(2);
    expect(parseMarkdown(serializeMarkdown(nodes)).ast.children).toEqual(nodes);
  });

  it("preserves separate HTML paragraphs instead of flattening them into one sentence", () => {
    const nodes = htmlToAst(
      "<ul><li><p>First.</p><p>Second.</p><ul><li>Nested.</li></ul></li></ul>",
      "https://example.org",
    ).blocks;
    expect(nodes[0]).toMatchObject({
      items: [
        {
          children: [
            { type: "paragraph" },
            { type: "paragraph" },
            { type: "list" },
          ],
        },
      ],
    });
    const markdown = serializeMarkdown(nodes);
    expect(markdown).not.toContain("<ul");
    expect(parseMarkdown(markdown).ast.children).toEqual(nodes);
  });

  it("keeps distinct lists inside a quote", () => {
    const nodes = htmlToAst(
      "<blockquote><ul><li>First.</li></ul><ul><li>Second.</li></ul></blockquote>",
      "https://example.org",
    ).blocks;
    expect(parseMarkdown(serializeMarkdown(nodes)).ast.children).toEqual(nodes);
  });
});
