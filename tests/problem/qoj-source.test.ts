import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { qojProblemAdapter } from "../../src/problem/adapters/qoj";
import { parseMarkdown } from "../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../src/problem/markdown/serialize";
import { inlineText } from "../../src/problem/markdown/text";
import { createSnapshot } from "./snapshot-fixtures";

const url = "https://qoj.ac/problem/1907";

describe("QOJ Source Markdown fidelity", () => {
  it("keeps the complete 1907 body and its actual H3/H4 hierarchy", async () => {
    const result = await qojProblemAdapter.extractSource(
      createSnapshot({
        url,
        html: readFileSync("docs/fixtures/problem/qoj-1907.html", "utf8"),
      }),
    );
    if (!result.ok) throw new Error(result.message ?? result.reason);
    expect(result.source.metadata).toMatchObject({
      oj: "qoj",
      problemId: "1907",
      title: "博弈",
      language: "zh",
      timeLimit: { display: "3 s" },
      memoryLimit: { display: "1024 MB" },
    });
    const markdown = result.source.sourceMarkdown;
    expect(markdown).toBe(
      readFileSync(
        "tests/problem/fixtures/qoj-1907.source.md",
        "utf8",
      ).replaceAll("\r\n", "\n"),
    );
    expect(markdown).not.toMatch(/data-ojtrace|提交源代码|nav-tabs/);
    const ast = parseMarkdown(markdown).ast;
    expect(
      ast.children.flatMap((node) =>
        node.type === "heading"
          ? [[node.level, inlineText(node.children)]]
          : [],
      ),
    ).toEqual([
      [3, "输入格式"],
      [3, "输出格式"],
      [3, "样例数据"],
      [4, "样例 1 输入"],
      [4, "样例 1 输出"],
      [4, "样例 2"],
      [3, "子任务"],
    ]);
    expect(parseMarkdown(serializeMarkdown(ast.children)).ast).toEqual(ast);
    if (process.env.OJTRACE_QA_DIR) {
      mkdirSync(process.env.OJTRACE_QA_DIR, { recursive: true });
      writeFileSync(
        resolve(process.env.OJTRACE_QA_DIR, "qoj-1907.source.md"),
        markdown,
      );
    }
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "keeps authored H%i without platform-wide promotion or demotion",
    async (level) => {
      const result = await qojProblemAdapter.extractSource(
        createSnapshot({
          url,
          html: `<h1 class="page-header">#1907. 博弈</h1><div id="tab-statement"><article><h${level}>Input <code>#7</code></h${level}><p>Authored section.</p></article></div>`,
        }),
      );
      if (!result.ok) throw new Error(result.reason);
      expect(result.source.sourceMarkdown).toBe(
        `${"#".repeat(level)} Input \`#7\`\n\nAuthored section.\n`,
      );
      expect(
        parseMarkdown(result.source.sourceMarkdown).ast.children[0],
      ).toMatchObject({ type: "heading", level });
    },
  );

  it.each([
    ["math/tex; mode=display", "\\sum_{i=1}^{n} a_i", true],
    ["math/tex", "a_i^2", false],
    ["application/x-tex", "\\frac{x}{y}", false],
  ])(
    "retains top-level TeX scripts of type %s",
    async (type, latex, display) => {
      const result = await qojProblemAdapter.extractSource(
        createSnapshot({
          url,
          html: `<h1 class="page-header">#1907. 博弈</h1><div id="tab-statement"><article><h2>原始标题</h2><span class="MathJax">visual glyphs</span><script type="${type}">${latex}</script><script>window.evil = "executable script";</script><style>.hidden { color: red; }</style><p>Original conclusion.</p></article></div>`,
        }),
      );
      if (!result.ok) throw new Error(result.reason);
      const markdown = result.source.sourceMarkdown;
      expect(markdown).toContain(latex);
      expect(markdown).not.toMatch(
        /visual glyphs|executable script|color: red|<script/,
      );
      expect(parseMarkdown(markdown).ast.children).toContainEqual(
        display
          ? { type: "math", value: latex }
          : {
              type: "paragraph",
              children: [{ type: "inline-math", value: latex }],
            },
      );
      expect(markdown).toContain("## 原始标题");
      expect(markdown).toContain("Original conclusion.");
    },
  );
});
