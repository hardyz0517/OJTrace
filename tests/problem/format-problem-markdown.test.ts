import { describe, expect, it } from "vitest";
import { formatProblemMarkdown } from "../../src/problem/format-problem-markdown";
import type { ProblemDocument } from "../../src/problem/domain";

function document(overrides: Partial<ProblemDocument> = {}): ProblemDocument {
  return {
    oj: "codeforces",
    problemId: "1327D",
    title: "D. Infinite Path",
    originalUrl: "https://codeforces.com/problemset/problem/1327/D",
    timeLimit: { display: "2 seconds", milliseconds: 2_000 },
    memoryLimit: { display: "256 megabytes", bytes: 256 * 1024 * 1024 },
    blocks: [],
    markdown: "You are given a permutation.\n\n## Input\n\n```text\n1\n```\n",
    assets: [],
    warnings: [],
    ...overrides,
  };
}

describe("formatProblemMarkdown", () => {
  it("puts the problem id, title, source and limits ahead of the statement", () => {
    expect(formatProblemMarkdown(document())).toBe(
      [
        "# 1327D D. Infinite Path",
        "",
        "- 来源：Codeforces",
        "- 原题：https://codeforces.com/problemset/problem/1327/D",
        "- 时间限制：2 seconds",
        "- 内存限制：256 megabytes",
        "",
        "You are given a permutation.",
        "",
        "## Input",
        "",
        "```text",
        "1",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("does not repeat an id that is already part of the title", () => {
    const markdown = formatProblemMarkdown(
      document({
        oj: "luogu",
        problemId: "P1001",
        title: "P1001 A+B Problem",
        originalUrl: "https://www.luogu.com.cn/problem/P1001",
        timeLimit: undefined,
        memoryLimit: undefined,
        markdown: "计算 $a+b$。\n",
      }),
    );
    expect(markdown.startsWith("# P1001 A+B Problem\n")).toBe(true);
    expect(markdown).not.toContain("# P1001 P1001");
    expect(markdown).toContain("- 来源：洛谷");
    expect(markdown).not.toContain("时间限制");
    expect(markdown).not.toContain("内存限制");
    expect(markdown.endsWith("计算 $a+b$。\n")).toBe(true);
  });
});
