import { describe, expect, it } from "vitest";
import { htmlToStatement } from "../../../src/problem/extract/html-to-statement";
import { serializeMarkdown } from "../../../src/problem/extract/markdown-serializer";

describe("sample extraction", () => {
  it.each([
    [
      "AtCoder sample headings",
      "<h3>Sample Input 1</h3><pre>1 2</pre><h3>Sample Output 1</h3><pre>3</pre>",
      "### Sample Input 1\n```text\n1 2\n```\n\n### Sample Output 1\n```text\n3\n```\n",
    ],
    [
      "Codeforces input/output title blocks",
      '<div class="input"><div class="title">Input</div><pre>1 2</pre></div><div class="output"><div class="title">Output</div><pre>3</pre></div>',
      "Input\n```text\n1 2\n```\n\nOutput\n```text\n3\n```\n",
    ],
    [
      "Chinese sample labels",
      "<h3>样例输入 1</h3><pre>1 2</pre><h3>样例输出 1</h3><pre>3</pre>",
      "### 样例输入 1\n```text\n1 2\n```\n\n### 样例输出 1\n```text\n3\n```\n",
    ],
  ])("groups %s into a sample block", (_name, html, markdown) => {
    const result = htmlToStatement(html, "https://example.org/problem/1", "zh");

    expect(result.blocks).toMatchObject([
      {
        type: "sample",
        input: { type: "code", value: "1 2" },
        output: { type: "code", value: "3" },
      },
    ]);
    expect(serializeMarkdown(result.blocks)).toBe(markdown);
    expect(markdown).not.toContain("**输入**");
    expect(markdown).not.toContain("**输出**");
  });

  it("leaves a Codeforces copier in place until that adapter removes it", () => {
    const result = htmlToStatement(
      '<div class="input"><div class="title">Input<div class="input-output-copier">Copy</div></div><pre>1 2</pre></div><div class="output"><div class="title">Output<div class="input-output-copier">Copy</div></div><pre>3</pre></div>',
      "https://example.org/problem/1",
      "zh",
    );
    expect(serializeMarkdown(result.blocks)).toContain("Copy");
    expect(result.blocks.some((block) => block.type === "sample")).toBe(false);
  });
  it("copies Luogu sample captions as level-3 headings", () => {
    const result = htmlToStatement(
      "<h2>输入输出样例</h2><p><b>输入 #1</b><button>复制</button></p><pre>20 30</pre><p><b>输出 #1</b><button>复制</button></p><pre>50</pre><h3>输入 #2</h3><pre>7</pre><h3>输出 #2</h3><pre>8</pre>",
      "https://www.luogu.com.cn/problem/P1001",
      "zh",
    );

    expect(serializeMarkdown(result.blocks)).toBe(
      [
        "## 输入输出样例",
        "",
        "### 输入 #1",
        "```text",
        "20 30",
        "```",
        "",
        "### 输出 #1",
        "```text",
        "50",
        "```",
        "",
        "### 输入 #2",
        "```text",
        "7",
        "```",
        "",
        "### 输出 #2",
        "```text",
        "8",
        "```",
        "",
      ].join("\n"),
    );
    expect(serializeMarkdown(result.blocks)).not.toContain("**");
  });

  it("keeps a statement rule outside AtCoder", () => {
    const result = htmlToStatement(
      "<p>Before</p><hr /><p>After</p>",
      "https://example.org/problem/1",
      "en",
    );
    expect(result.blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "thematic-break",
      "paragraph",
    ]);
  });
});
