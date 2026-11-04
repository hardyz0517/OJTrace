import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { luoguProblemAdapter } from "../../src/problem/adapters/luogu";
import { convertSourceToCnoi } from "../../src/problem/cnoi/convert";
import { parseProblemMarkdown } from "../../src/problem/problem-markdown";
import { parseMarkdown } from "../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../src/problem/markdown/serialize";
import { createSnapshot } from "./snapshot-fixtures";

async function extract(
  content: Record<string, unknown>,
  samples = [["1\n", "2\n"]],
) {
  const result = await luoguProblemAdapter.extractSource(
    createSnapshot({
      url: "https://www.luogu.com.cn/problem/P1",
      html: "<main><h1>P1 Original</h1></main>",
      sourceData: { luoguProblem: { name: "Original", content, samples } },
    }),
  );
  if (!result.ok) throw new Error(result.message ?? result.reason);
  return result.source;
}

describe("readable Source Markdown", () => {
  it("copies native prose and layout directives without serializing them into HTML", async () => {
    const description =
      "原始 **正文** $a_i$。\n\n:::align{center}\n\n居中 $x^2$。\n\n:::\n\n第二段。";
    const source = await extract({
      locale: "zh",
      description,
      formatI: "读取 $n$。",
      formatO: "输出答案。",
      hint: "原始提示。",
    });
    expect(source.sourceMarkdown).toBe(
      "# P1 Original\n\n## 题目描述\n\n" +
        description +
        "\n\n## 输入格式\n\n读取 $n$。\n\n## 输出格式\n\n输出答案。" +
        "\n\n## 输入输出样例 #1\n\n### 输入 #1\n\n```\n1\n\n```\n\n### 输出 #1\n\n```\n2\n\n```" +
        "\n\n## 说明/提示\n\n原始提示。\n",
    );
    expect(source.sourceMarkdown).not.toMatch(
      /<section|<p>|<span|<pre|data-ojtrace/,
    );
    const before = JSON.stringify(source);
    const converted = convertSourceToCnoi(source);
    if (!converted.ok) throw new Error(converted.message);
    const parsed = parseProblemMarkdown(
      converted.value.cnoiMarkdown,
      converted.value,
    );
    if (!parsed.ok) throw new Error(parsed.message);
    expect(
      parsed.value.ast.children.some((node) => node.type === "align"),
    ).toBe(true);
    expect(
      parsed.value.ast.children
        .filter((node) => node.type === "code")
        .map((node) => node.value),
    ).toEqual(["1\n", "2\n"]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("keeps real native headings and necessary author HTML without private field attributes", async () => {
    const description =
      '## 题目描述\n\n### 子标题\n\n文字。\n\n<img src="diagram.png" width="140" alt="示意">';
    const source = await extract({ locale: "zh", description });
    expect(source.sourceMarkdown).toContain(description);
    expect(source.sourceMarkdown.match(/^## 题目描述$/gm)).toHaveLength(1);
    expect(source.sourceMarkdown).not.toContain("data-ojtrace");
    expect(source.assets[0]?.sourceUrl).toBe(
      "https://www.luogu.com.cn/problem/diagram.png",
    );
  });

  it.each([
    ["en", "Original description.", "Problem Statement", "Input", "Output"],
    ["ja", "元の問題文です。", "問題文", "入力", "出力"],
  ])(
    "retains the selected %s version and language in ordinary source headings",
    async (locale, description, title, input, output) => {
      const source = await extract({
        locale,
        description,
        formatI: "n",
        formatO: "answer",
      });
      expect(source.sourceMarkdown).toContain(`## ${title}`);
      expect(source.sourceMarkdown).toContain(`## ${input}`);
      expect(source.sourceMarkdown).toContain(`### ${output}`);
      expect(source.sourceMarkdown).not.toMatch(
        /题目描述|输入格式|样例输入|data-ojtrace/,
      );
      const converted = convertSourceToCnoi(source);
      if (!converted.ok) throw new Error(converted.message);
      expect(converted.value.cnoiMarkdown).toContain(
        locale === "ja" ? "入力例" : "Sample Input",
      );
    },
  );

  it.each([
    "",
    "x",
    "\nx\n\n",
    "  x\n  y\n",
    "a```b\n",
    "<tag>\n$$literal$$\n",
  ])(
    "uses readable fences while preserving plain code content: %j",
    (value) => {
      const ast = {
        type: "root" as const,
        children: [{ type: "code" as const, value, language: "text" }],
      };
      const markdown = serializeMarkdown(ast.children);
      expect(markdown).not.toMatch(/<pre|<code|data-ojtrace/);
      expect(parseMarkdown(markdown).ast).toEqual(ast);
    },
  );

  it("retains escaped, HTML and code copies of layout markers as literal content", () => {
    for (const markdown of [
      "\\:::align{center}\n\nText\n\n\\:::",
      '<p><span data-ojtrace-text="true">:::align{center}</span></p>\n\nText\n\n<p>:::</p>',
      "```text\n:::align{center}\n\nText\n\n:::\n```",
    ]) {
      const ast = parseMarkdown(markdown).ast;
      expect(ast.children.some((node) => node.type === "align")).toBe(false);
      expect(parseMarkdown(serializeMarkdown(ast.children)).ast).toEqual(ast);
    }
  });

  it("bounds nested layout directives in the generic parser", () => {
    const markdown =
      ":::align{center}\n\n".repeat(130) + "Text\n\n" + ":::\n\n".repeat(130);
    expect(() => parseMarkdown(markdown)).toThrow("directive depth");
  });

  it("keeps P5665 source readable before conversion, including formulas, table and native samples", async () => {
    const native = JSON.parse(
      readFileSync("tests/problem/fixtures/luogu-p5665-math.json", "utf8"),
    );
    const result = await luoguProblemAdapter.extractSource(
      createSnapshot({
        url: "https://www.luogu.com.cn/problem/P5665",
        html: "<main><h1>P5665 划分</h1></main>",
        sourceData: { luoguProblem: native.data.problem },
      }),
    );
    if (!result.ok) throw new Error(result.message ?? result.reason);
    const source = result.source.sourceMarkdown;
    // This is the complete source-copy text supplied by the user, not a
    // snapshot generated from our Adapter or Transformer implementation.
    expect(source).toBe(
      readFileSync(
        "tests/problem/fixtures/luogu-p5665.source.md",
        "utf8",
      ).replace(/\r\n/g, "\n"),
    );
    expect(source).toContain(native.data.problem.contenu.description);
    expect(source).toContain(String.raw`\sum_{i=1}^{k_1}`);
    expect(source).toContain("| 测试点编号 | $n \\leq$");
    expect(source).not.toMatch(/<section|<span|<pre|<table|data-ojtrace/);
    expect(source).toContain("## 输入格式");
    expect(source).toContain("## 说明/提示");
    const codes = parseMarkdown(source).ast.children.filter(
      (node) => node.type === "code",
    );
    expect(codes.map((node) => node.value)).toEqual(
      native.data.problem.samples.flat(),
    );
    if (process.env.OJTRACE_QA_DIR) {
      mkdirSync(process.env.OJTRACE_QA_DIR, { recursive: true });
      writeFileSync(
        resolve(process.env.OJTRACE_QA_DIR, "luogu-p5665.source.md"),
        source,
      );
    }
  });
});
