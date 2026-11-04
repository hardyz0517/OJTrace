import { describe, expect, it } from "vitest";
import { htmlToAst } from "../../../src/problem/markdown/html";
import { parseMarkdown } from "../../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../../src/problem/markdown/serialize";

describe("neutral source syntax and controlled HTML", () => {
  it.each([
    '<mjx-container display="true"><svg><path d="M 0 0 L 1 1"></path></svg></mjx-container>',
    '<span class="katex"><span class="katex-html">i=1Σk1ai</span></span>',
    "<mjx-container><math><msubsup><mo>∑</mo><mi>i=1</mi><mi>k1</mi></msubsup></math></mjx-container>",
    '<math><semantics><msub><mi>a</mi><mi>i</mi></msub><annotation encoding="application/mathml+xml">not TeX</annotation></semantics></math>',
  ])("rejects rendered-only math instead of inventing LaTeX: %s", (html) => {
    expect(() => htmlToAst(html, "https://example.org")).toThrow("LaTeX 源码");
  });
  it.each([
    ["Sample Input 7", "Sample Output 7"],
    ["样例输入 7", "样例输出 7"],
    ["入力例 7", "出力例 7"],
  ])("preserves %s / %s without semantic grouping", (input, output) => {
    const nodes = htmlToAst(
      `<h3>${input}</h3><pre>1</pre><h3>${output}</h3><pre>2</pre>`,
      "https://example.org",
    ).blocks;
    expect(nodes.map((node) => node.type)).toEqual([
      "heading",
      "code",
      "heading",
      "code",
    ]);
    expect(parseMarkdown(serializeMarkdown(nodes)).ast.children).toEqual(nodes);
  });
  it("retains bold labels and copier-like text unless an Adapter removed the page control", () => {
    const nodes = htmlToAst(
      '<p><b>输入 #1</b></p><pre>20 30</pre><div class="input-output-copier">Copy as author text</div>',
      "https://example.org",
    ).blocks;
    const markdown = serializeMarkdown(nodes);
    expect(markdown).toContain("**输入 #1**");
    expect(markdown).toContain("Copy as author text");
    expect(markdown).not.toContain("## 输入");
  });
  it("preserves explicit image titles and native figure captions", () => {
    const ast = parseMarkdown(
      '<figure><img src="https://example.org/a.png" title="Original title" width="120"><figcaption>Original caption.</figcaption></figure>',
    ).ast;
    expect(ast.children[0]).toMatchObject({
      type: "figure",
      blocks: [
        { type: "image", title: "Original title", width: 120 },
        { type: "paragraph", caption: true },
      ],
    });
    expect(parseMarkdown(serializeMarkdown(ast.children)).ast).toEqual(ast);
  });
  it("keeps tag-like text inside ordinary Markdown code fences", () => {
    const markdown = "~~~html\n</section>\n~~~\n\nAfter code.\n";
    expect(parseMarkdown(markdown).ast.children).toMatchObject([
      { type: "code", value: "</section>" },
      { type: "paragraph" },
    ]);
  });
  it("supports single-quoted controlled image dimensions", () => {
    expect(
      parseMarkdown("<img src='https://example.org/a.png' width='120'>").ast
        .children[0],
    ).toMatchObject({ type: "image", width: 120 });
  });
  it("retains task checkbox states in Markdown and DOM sources", () => {
    const ast = parseMarkdown("- [x] Done\n- [ ] Todo\n").ast;
    expect(ast.children[0]).toMatchObject({
      type: "list",
      items: [{ checked: true }, { checked: false }],
    });
    expect(parseMarkdown(serializeMarkdown(ast.children)).ast).toEqual(ast);
    const dom = htmlToAst(
      '<ul><li><input type="checkbox" checked>Done</li><li><input type="checkbox">Todo</li></ul>',
      "https://example.org",
    );
    expect(dom.blocks[0]).toMatchObject({
      type: "list",
      items: [{ checked: true }, { checked: false }],
    });
  });
});
