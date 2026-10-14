import { describe, expect, it } from "vitest";
import {
  parseHtmlDocument,
  serializeNode,
} from "../../../src/problem/extract/html-document";
import { htmlToStatement } from "../../../src/problem/extract/html-to-statement";
import { serializeMarkdown } from "../../../src/problem/extract/markdown-serializer";
import { statementBlocksToTypst } from "../../../src/problem/render/statement-to-typst";

const BASE_URL = "https://example.org/problem/1";

describe("statement extraction round trips", () => {
  it("escapes decoded text during the intermediate HTML serialization", () => {
    const original = `<p>Text &lt;tag&gt; &amp; entity: &quot;x&quot;</p><p>&lt;img src=x onerror=alert(1)&gt;</p>`;
    const root = parseHtmlDocument(original);
    const result = htmlToStatement(serializeNode(root), BASE_URL);

    expect(result.blocks).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: 'Text <tag> & entity: "x"' }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", value: "<img src=x onerror=alert(1)>" }],
      },
    ]);
  });

  it("preserves adjacent paragraphs instead of dropping or flattening them", () => {
    const result = htmlToStatement(
      "<p>First paragraph.</p><p>Second paragraph.</p>",
      BASE_URL,
    );
    expect(result.blocks).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "First paragraph." }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", value: "Second paragraph." }],
      },
    ]);
  });

  it("keeps Codeforces example lines separated inside preformatted blocks", () => {
    const result = htmlToStatement(
      `<div class="input"><div class="title">Input</div><pre><div class="test-example-line">2 3</div><div class="test-example-line">4 5</div></pre></div>`,
      BASE_URL,
    );
    expect(result.blocks).toMatchObject([
      {
        type: "sample",
        input: { type: "code", value: "2 3\n4 5" },
        inputLabel: {
          type: "paragraph",
          children: [{ type: "text", value: "Input" }],
        },
      },
    ]);
    expect(serializeMarkdown(result.blocks)).toBe(
      "Input\n```text\n2 3\n4 5\n```\n",
    );
  });

  it("keeps wrapped list text and inline formulas in a single sentence", () => {
    const result = htmlToStatement(
      `<ul><li><div><p>对于</p><p>$100\\%$</p><p>的数据，保证 <span class="katex" data-math="1 &lt;= n &lt;= 1000"></span>。</p></div></li></ul>`,
      BASE_URL,
    );

    expect(result.blocks).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          {
            children: [
              {
                type: "paragraph",
                children: [
                  { type: "text", value: "对于 " },
                  { type: "inline-math", value: "100\\%" },
                  { type: "text", value: " 的数据，保证 " },
                  { type: "inline-math", value: "1 <= n <= 1000" },
                  { type: "text", value: "。" },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("retains inline and display math source in typed AST nodes", () => {
    const result = htmlToStatement(
      `<p>Inline $x+1$ and \\(y+2\\).</p><p>Display $$a+b$$ or \\[c+d\\]</p><p><span data-math="q^2" class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>wrong fallback</mi></mrow><annotation encoding="application/x-tex">rendered-value</annotation></semantics></math></span></span></p><span class="katex-display"><span class="katex"><math alttext="z=3"></math></span></span>`,
      BASE_URL,
    );

    expect(result.blocks[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "Inline " },
        { type: "inline-math", value: "x+1" },
        { type: "text", value: " and " },
        { type: "inline-math", value: "y+2" },
        { type: "text", value: "." },
      ],
    });
    expect(result.blocks[1]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "Display " },
        { type: "inline-math", value: "a+b", display: true },
        { type: "text", value: " or " },
        { type: "inline-math", value: "c+d", display: true },
      ],
    });
    expect(result.blocks[2]).toMatchObject({
      type: "paragraph",
      children: [{ type: "inline-math", value: "q^2" }],
    });
    expect(result.blocks[3]).toEqual({ type: "math", value: "z=3" });
  });

  it("treats standalone MathML as a display math block by default", () => {
    const result = htmlToStatement(
      `<math alttext="x^2"><semantics><annotation>x^2</annotation></semantics></math>`,
      BASE_URL,
    );
    expect(result.blocks).toEqual([{ type: "math", value: "x^2" }]);
  });

  it("uses MathJax's TeX script once and avoids its adjacent visual duplicate", () => {
    const result = htmlToStatement(
      `<p><span class="MathJax_Preview">preview glyphs</span><script type="math/tex">x^2+1</script><span class="MathJax" id="MathJax-Element-1">rendered glyphs</span></p>`,
      BASE_URL,
    );
    expect(result.blocks).toEqual([
      {
        type: "paragraph",
        children: [{ type: "inline-math", value: "x^2+1" }],
      },
    ]);
  });

  it("extracts TeX scripts before removing unsafe scripts", () => {
    const result = htmlToStatement(
      `<p>Before<script type="math/tex">x &lt; y</script> after</p><script type="math/tex; mode=display">\\sum_{i=1}^n i</script><script>alert(1)</script>`,
      BASE_URL,
    );

    expect(result.blocks).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Before" },
          { type: "inline-math", value: "x &lt; y" },
          { type: "text", value: " after" },
        ],
      },
      { type: "math", value: "\\sum_{i=1}^n i" },
    ]);
  });

  it("does not promote the first body row into an implicit table header", () => {
    const result = htmlToStatement(
      `<table><tbody><tr><td>first</td><td>row</td></tr><tr><td>second</td><td>row</td></tr></tbody></table>`,
      BASE_URL,
    );
    expect(result.blocks[0]).toMatchObject({
      type: "table",
      headers: [],
      rows: [
        [[{ type: "text", value: "first" }], [{ type: "text", value: "row" }]],
        [[{ type: "text", value: "second" }], [{ type: "text", value: "row" }]],
      ],
    });
  });

  it("labels sample input/output, escapes table pipes, and grows code fences", () => {
    const markdown = serializeMarkdown([
      {
        type: "sample",
        input: { type: "code", value: "a```b", language: "text" },
        output: { type: "code", value: "x|y", language: "text" },
      },
      {
        type: "table",
        headers: [[{ type: "text", value: "A|B" }]],
        rows: [[[{ type: "inline-code", value: "x|y" }]]],
      },
    ]);

    expect(markdown).toContain("**输入**\n````text\na```b\n````");
    expect(markdown).toContain("**输出**\n```text\nx|y\n```");
    expect(markdown).toContain("| A\\|B |");
    expect(markdown).toContain("| `x\\|y` |");
  });

  it("keeps headerless table rows as body rows in Markdown", () => {
    const markdown = serializeMarkdown([
      {
        type: "table",
        headers: [],
        rows: [
          [
            [{ type: "text", value: "first" }],
            [{ type: "text", value: "row" }],
          ],
          [
            [{ type: "text", value: "second" }],
            [{ type: "text", value: "row" }],
          ],
        ],
      },
    ]);
    expect(markdown).toContain("|  |  |");
    expect(markdown).toContain("| first | row |");
    expect(markdown).toContain("| second | row |");
  });

  it("uses one TeX source for rendered AtCoder vars and code templates", () => {
    const katexVar = (tex: string, visual: string): string =>
      `<var><span class="katex"><span class="katex-mathml"><math><semantics><mrow>${visual}</mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${visual}</span></span></var>`;
    const variable = katexVar("N", "N");
    const limit = katexVar(String.raw`2 \leq N \leq 400`, "2≤N≤400");
    const result = htmlToStatement(
      `<p>${variable} 個と ${limit}。</p><p><var>H_1</var> と <var>x<sub>i</sub></var> と <var>\\(T_i\\)</var></p><pre>${variable} ${katexVar("M", "M")}
${katexVar("A_{1, 1}", "A11")} ${katexVar("A_{1, 2}", "A12")} ${katexVar("...", "...")} ${katexVar("A_{1, N}", "A1N")}
${katexVar(String.raw`\mathrm{query}_1`, "query1")}
${katexVar(String.raw`\vdots`, "vdots")}</pre>`,
      BASE_URL,
    );

    expect(result.blocks[0]).toEqual({
      type: "paragraph",
      children: [
        { type: "inline-math", value: "N" },
        { type: "text", value: " 個と " },
        { type: "inline-math", value: String.raw`2 \leq N \leq 400` },
        { type: "text", value: "。" },
      ],
    });
    expect(result.blocks[1]).toEqual({
      type: "paragraph",
      children: [
        { type: "inline-math", value: "H_1" },
        { type: "text", value: " と " },
        { type: "inline-math", value: "x_{i}" },
        { type: "text", value: " と " },
        { type: "inline-math", value: "T_i" },
      ],
    });
    expect(result.blocks[2]).toEqual({
      type: "code",
      value: "N M\nA_1, 1 A_1, 2 ... A_1, N\nquery_1\n⋮",
      lines: [
        [
          { type: "inline-math", value: "N" },
          { type: "text", value: " " },
          { type: "inline-math", value: "M" },
        ],
        [
          { type: "inline-math", value: "A_{1, 1}" },
          { type: "text", value: " " },
          { type: "inline-math", value: "A_{1, 2}" },
          { type: "text", value: " " },
          { type: "inline-math", value: "..." },
          { type: "text", value: " " },
          { type: "inline-math", value: "A_{1, N}" },
        ],
        [{ type: "inline-math", value: String.raw`\mathrm{query}_1` }],
        [{ type: "inline-math", value: String.raw`\vdots` }],
      ],
    });
    const typst = statementBlocksToTypst(result.blocks);
    expect(typst).toContain('#mi(block: false, "N")');
    expect(typst).toContain(
      String.raw`#mi(block: false, "2 \\leq N \\leq 400")`,
    );
    expect(typst).not.toContain("N N N");
    expect(typst).not.toContain("2≤N≤4002");
    expect(typst).toContain("#oj-sample-lines");
    expect(typst).toContain('#mi(block: false, "A_{1, 1}")');
    expect(typst).toContain(String.raw`#mi(block: false, "\\mathrm{query}_1")`);
    expect(typst).toContain(String.raw`#mi(block: false, "\\vdots")`);
    expect(typst).toContain(String.raw`#mi(block: false, "\\ldots")`);
    expect(typst).not.toContain("A_1, 1");
  });

  it("keeps Codeforces triple-dollar formulas on the same line", () => {
    const result = htmlToStatement(
      "<p>A $$$3$$$-beautiful necklace is also $$$k$$$-beautiful.</p><p>$$$$$$a+b$$$$$$</p>",
      BASE_URL,
    );

    expect(result.blocks).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "A " },
          { type: "inline-math", value: "3" },
          { type: "text", value: "-beautiful necklace is also " },
          { type: "inline-math", value: "k" },
          { type: "text", value: "-beautiful." },
        ],
      },
      {
        type: "paragraph",
        children: [{ type: "inline-math", value: "a+b", display: true }],
      },
    ]);
    const typst = statementBlocksToTypst(result.blocks);
    expect(typst).toContain('#mi(block: false, "3")\\-beautiful');
    expect(typst).toContain('#mi(block: false, "k")\\-beautiful');
    expect(typst).not.toMatch(/\$\s+3\s+\$/);
  });

  it("keeps a Codeforces centered caption together and records image zoom", () => {
    const narrow = "https://espresso.codeforces.com/narrow.png";
    const wide = "https://espresso.codeforces.com/wide.png";
    const result = htmlToStatement(
      `<div><p>We call a necklace <span class="tex-span"><i>k</i></span>-beautiful.</p><center><img class="tex-graphics" src="${narrow}" alt="narrow" style="zoom: 75%;max-width: 100%;max-height: 100%;" /><br />The first necklace cannot be assembled because it has three beads "<span class="tex-span"><i>a</i></span>" (of the two available).</center><center>As you can see, this necklace is, for example, <span class="tex-font-style-bf">3</span>-beautiful, <span class="tex-font-style-bf">6</span>-beautiful, <span class="tex-font-style-bf">9</span>-beautiful, and so on.</center><center><img class="tex-graphics" src="${wide}" alt="wide" style="zoom: 75%;max-width: 100%;max-height: 100%;" /></center></div>`,
      "https://codeforces.com/problemset/problem/1367/E",
    );

    expect(result.blocks).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "We call a necklace " },
          { type: "emphasis", children: [{ type: "text", value: "k" }] },
          { type: "text", value: "-beautiful." },
        ],
      },
      {
        type: "align",
        align: "center",
        blocks: [
          {
            type: "image",
            url: narrow,
            alt: "narrow",
            zoom: 0.75,
            maxWidthRatio: 1,
            maxHeightRatio: 1,
          },
          {
            type: "paragraph",
            caption: true,
            children: [
              {
                type: "text",
                value:
                  'The first necklace cannot be assembled because it has three beads "',
              },
              { type: "emphasis", children: [{ type: "text", value: "a" }] },
              { type: "text", value: '" (of the two available).' },
            ],
          },
        ],
      },
      {
        type: "align",
        align: "center",
        blocks: [
          {
            type: "paragraph",
            children: [
              {
                type: "text",
                value: "As you can see, this necklace is, for example, ",
              },
              { type: "strong", children: [{ type: "text", value: "3" }] },
              { type: "text", value: "-beautiful, " },
              { type: "strong", children: [{ type: "text", value: "6" }] },
              { type: "text", value: "-beautiful, " },
              { type: "strong", children: [{ type: "text", value: "9" }] },
              { type: "text", value: "-beautiful, and so on." },
            ],
          },
        ],
      },
      {
        type: "align",
        align: "center",
        blocks: [
          {
            type: "image",
            url: wide,
            alt: "wide",
            zoom: 0.75,
            maxWidthRatio: 1,
            maxHeightRatio: 1,
          },
        ],
      },
    ]);
    const typst = statementBlocksToTypst(result.blocks);
    expect(typst).toContain(
      '#text(size: 10.5pt)[The first necklace cannot be assembled because it has three beads "_a_" (of the two available).]',
    );
    expect(typst).toContain(
      "*3*\\-beautiful, *6*\\-beautiful, *9*\\-beautiful",
    );
    expect(typst).not.toContain("#text(size: 10.5pt)[As you can see");
    expect(typst).not.toContain("width: 100%");
  });

  it("keeps quoted typewriter words as prose and leaves bare identifiers as code", () => {
    const result = htmlToStatement(
      '<p>It has three beads <span class="tex-font-style-tt">"a"</span> (of the two available). The second contains a bead "<span class="tex-font-style-tt">d</span>", which is not sold. Use <span class="tex-font-style-tt">n</span> and <span class="tex-font-style-tt">\u201ca\u201d</span>.</p>',
      BASE_URL,
    );

    expect(result.blocks).toEqual([
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            value:
              'It has three beads "a" (of the two available). The second contains a bead "d", which is not sold. Use ',
          },
          { type: "inline-code", value: "n" },
          { type: "text", value: " and \u201ca\u201d." },
        ],
      },
    ]);
    const typst = statementBlocksToTypst(result.blocks);
    expect(typst).toContain('beads "a" (of the two available)');
    expect(typst).toContain('bead "d", which is not sold');
    expect(typst).not.toContain('#raw("\\"a\\""');
    expect(typst).not.toContain('#raw("d"');
    expect(typst).toContain('#raw("n", lang: "txt", block: false)');
  });

  it("treats a centered note under a separate image as a smaller caption", () => {
    const result = htmlToStatement(
      '<center><img src="https://example.org/beads.png" alt="beads" /></center><center>The first necklace cannot be assembled.</center><p>We call a necklace beautiful.</p>',
      BASE_URL,
    );

    expect(result.blocks[1]).toEqual({
      type: "align",
      align: "center",
      blocks: [
        {
          type: "paragraph",
          caption: true,
          children: [
            {
              type: "text",
              value: "The first necklace cannot be assembled.",
            },
          ],
        },
      ],
    });
    expect(result.blocks[2]).toEqual({
      type: "paragraph",
      children: [{ type: "text", value: "We call a necklace beautiful." }],
    });
    const typst = statementBlocksToTypst(result.blocks);
    expect(typst).toContain(
      "#text(size: 10.5pt)[The first necklace cannot be assembled.]",
    );
    expect(typst).toContain("We call a necklace beautiful.");
    expect(typst).not.toContain(
      "#text(size: 10.5pt)[We call a necklace beautiful.]",
    );
  });
});
