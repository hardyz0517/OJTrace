import { describe, expect, it } from "vitest";
import type { CodeBlock } from "../../../src/problem/markdown/ast";
import { parseMarkdown } from "../../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../../src/problem/markdown/serialize";
import { htmlToAst } from "../../../src/problem/markdown/html";
import { STATEMENT_NODE_LIMIT } from "../../../src/problem/budget";

describe("explicit text+math fences", () => {
  it("keeps preformatted layout and original LaTeX without private HTML", () => {
    const original = htmlToAst(
      String.raw`<pre><var>N</var>  <var>M</var>
<var>\mathrm{ans}_{i}</var>    <var>\ldots</var>
</pre>`,
      "https://example.org",
    ).blocks;
    const markdown = serializeMarkdown(original);
    expect(markdown).toBe(
      "```text+math\n$N$  $M$\n$\\mathrm{ans}_{i}$    $\\ldots$\n```\n",
    );
    expect(parseMarkdown(markdown).ast.children).toEqual(original);
    expect(serializeMarkdown(parseMarkdown(markdown).ast.children)).toBe(
      markdown,
    );
  });

  it("keeps literal markup, dollar signs, backslashes, fences, indentation and empty lines", () => {
    const node: CodeBlock = {
      type: "code",
      value: "\n  **raw** <tag> $literal$ \\ \\(: ```  x_1\n\n",
      lines: [
        [],
        [
          { type: "text", value: "  **raw** <tag> $literal$ \\ \\(: ```  " },
          { type: "inline-math", value: "x_{1}" },
        ],
        [],
        [],
      ],
    };
    const markdown = serializeMarkdown([node]);
    expect(markdown).toContain("````text+math");
    expect(markdown).not.toContain("<pre");
    expect(parseMarkdown(markdown).ast.children).toEqual([node]);
  });

  it("does not interpret formulas in ordinary samples or a literal language name", () => {
    expect(parseMarkdown("```\n$N$ $M$\n```\n").ast.children).toEqual([
      { type: "code", value: "$N$ $M$" },
    ]);
    const literal: CodeBlock = {
      type: "code",
      value: "$N$",
      language: "text+math",
    };
    expect(parseMarkdown(serializeMarkdown([literal])).ast.children).toEqual([
      literal,
    ]);
  });

  it("keeps incomplete user edits as literal content rather than deleting them", () => {
    const ast = parseMarkdown("```text+math\n$N$  $unfinished\n```\n").ast;
    expect(ast.children[0]).toMatchObject({
      type: "code",
      lines: [
        [
          { type: "inline-math", value: "N" },
          { type: "text", value: "  $unfinished" },
        ],
      ],
    });
    expect(parseMarkdown(serializeMarkdown(ast.children)).ast).toEqual(ast);
  });

  it.each(["x\\", "x\ny", String.raw`\text{\$}`])(
    "retains richer math with controlled HTML when this fence cannot express it: %j",
    (value) => {
      const node = htmlToAst(
        `<pre><span data-math="${value}"></span></pre>`,
        "https://example.org",
      ).blocks;
      const markdown = serializeMarkdown(node);
      expect(markdown).toContain("<pre");
      expect(parseMarkdown(markdown).ast.children).toEqual(node);
    },
  );

  it("bounds empty lines as well as inline nodes", () => {
    expect(() =>
      parseMarkdown(
        "```text+math\n" + "\n".repeat(STATEMENT_NODE_LIMIT + 1) + "```\n",
      ),
    ).toThrow(/budget/);
  });
});
