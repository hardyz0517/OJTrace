import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  ProblemLanguage,
  ProblemMetadata,
  SourceProblem,
} from "../../../src/problem/domain";
import type { SourceId } from "../../../src/domain/types";
import { parseMarkdown } from "../../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../../src/problem/markdown/serialize";
import { convertSourceToCnoi } from "../../../src/problem/cnoi/convert";
import { ojRules, transformToCnoi } from "../../../src/problem/cnoi/transform";
import {
  readProblemMarkdown,
  parseProblemMarkdown,
} from "../../../src/problem/problem-markdown";

const metadata = (
  oj: SourceId,
  language: ProblemLanguage,
): ProblemMetadata => ({
  oj,
  problemId: "fixture-1",
  title: "Fixture",
  originalUrl: "https://example.org/p/1",
  language,
});
function freeze(value: unknown) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
}
function body(
  sourceMarkdown: string,
  oj: SourceId = "codeforces",
  language: ProblemLanguage = "en",
) {
  const converted = convertSourceToCnoi({
    sourceMarkdown,
    metadata: metadata(oj, language),
    assets: [],
    warnings: [],
  });
  if (!converted.ok) throw new Error(converted.message);
  const read = readProblemMarkdown(converted.value.cnoiMarkdown);
  if (!read.ok) throw new Error(read.message);
  return read.value.body;
}

describe("independent Source Markdown fixtures", () => {
  it("converts QOJ 1907 from fixed Source alone and retains the second sample's attachment note", () => {
    const source = readFileSync(
      "tests/problem/fixtures/qoj-1907.source.md",
      "utf8",
    ).replaceAll("\r\n", "\n");
    const ast = parseMarkdown(source).ast;
    freeze(ast);
    const converted = transformToCnoi(ast, metadata("qoj", "zh"));
    expect(serializeMarkdown(converted.ast.children)).toBe(
      readFileSync(
        "tests/problem/fixtures/qoj-1907.cnoi-body.md",
        "utf8",
      ).replaceAll("\r\n", "\n"),
    );
    expect(serializeMarkdown(ast.children)).toBe(source);
  });
  it("converts the user-provided P5665 source with numbered groups and a problem title", () => {
    const sourceMarkdown = readFileSync(
      "tests/problem/fixtures/luogu-p5665.source.md",
      "utf8",
    ).replace(/\r\n/g, "\n");
    const source: SourceProblem = {
      metadata: {
        oj: "luogu",
        problemId: "P5665",
        title: "[CSP-S 2019] 划分",
        originalUrl: "https://www.luogu.com.cn/problem/P5665",
        language: "zh",
      },
      sourceMarkdown,
      assets: [],
      warnings: [],
    };
    freeze(source);
    const result = convertSourceToCnoi(source);
    if (!result.ok) throw new Error(result.message);
    const read = readProblemMarkdown(result.value.cnoiMarkdown);
    if (!read.ok) throw new Error(read.message);
    expect(read.value.body).not.toMatch(/^# P5665|输入输出样例/m);
    expect(read.value.body.match(/^## 样例(?:输入|输出) #\d+$/gm)).toEqual(
      [1, 2, 3].flatMap((id) => [`## 样例输入 #${id}`, `## 样例输出 #${id}`]),
    );
    expect(
      parseMarkdown(read.value.body).ast.children.filter(
        (node) => node.type === "code",
      ),
    ).toHaveLength(6);
    expect(source.sourceMarkdown).toBe(sourceMarkdown);
  });

  it.each([
    ["codeforces", "context", "en"],
    ["atcoder", "japanese", "ja"],
    ["qoj", "wrapper", "en"],
    ["hydroj", "chinese", "zh"],
    ["luogu", "fields", "en"],
  ] as const)(
    "converts %s/%s without an Adapter or network",
    (oj, name, language) => {
      const read = (suffix: string) =>
        readFileSync(
          new URL(
            `../fixtures/source-markdown/${oj}/${name}.${suffix}.md`,
            import.meta.url,
          ),
          "utf8",
        ).replaceAll("\r\n", "\n");
      expect(body(read("source"), oj, language)).toBe(read("expected"));
    },
  );
  it("exposes independent serializable configurations for all five sites", () => {
    expect(Object.keys(ojRules).sort()).toEqual([
      "atcoder",
      "codeforces",
      "hydroj",
      "luogu",
      "qoj",
    ]);
    expect(JSON.parse(JSON.stringify(ojRules))).toEqual(ojRules);
  });
  it("preserves noncontinuous, conflicting, letter and Roman identifiers without pairing or renumbering", () => {
    const source =
      "## Sample Input 2\n\n```\n1\n```\n\n## Sample Output 3\n\n```\n2\n```\n\n## Sample Input VII\n\n```\n3\n```\n\n## Sample Output A\n\n```\n4\n```\n";
    expect(body(source)).toBe(source);
  });
  it("retains unknown sections, score information, separators and identical real examples", () => {
    const source =
      "## Interaction Protocol\n\nDo not drop this.\n\n---\n\n## Score\n\n100 points.\n\n## Sample Input 2\n\n```\n1\n```\n\n## Sample Input 7\n\n```\n1\n```\n";
    expect(body(source, "atcoder")).toBe(source);
  });
  it("keeps wrapper prefaces and rich blocks when removing the wrapper heading", () => {
    const source =
      '## Examples\n\nPreface.\n\n<img src="https://example.org/a.png" width="120">\n\n### Input\n\n```\n1\n```\n';
    const converted = body(source);
    expect(converted).not.toContain("## Examples");
    expect(converted).toContain("Preface.");
    expect(converted).toContain('width="120"');
    expect(converted).toContain("## Sample Input");
    expect(converted).not.toMatch(/#1|Input 1/);
  });
  it("does not classify quoted or explanation-local Input as a format or sample", () => {
    const source =
      "## Examples\n\n### Explanation\n\n> #### Input\n> Keep this quoted title.\n\n#### Input\n\nAn explanation subsection.\n";
    const result = body(source);
    expect(result).not.toContain("Sample Input");
    expect(result).toContain("### Input");
    expect(result).toContain("> #### Input");
  });
  it("freezes Source and syntax input, is deterministic, and follows only changed Markdown", () => {
    const source: SourceProblem = {
      metadata: metadata("codeforces", "en"),
      sourceMarkdown:
        "## Input\n\nFormat.\n\n## Examples\n\n### Input\n\nSample.\n",
      assets: [],
      warnings: [],
    };
    const before = JSON.stringify(source);
    freeze(source);
    const parsed = parseMarkdown(source.sourceMarkdown);
    freeze(parsed.ast);
    expect(transformToCnoi(parsed.ast, source.metadata)).toEqual(
      transformToCnoi(parsed.ast, source.metadata),
    );
    expect(convertSourceToCnoi(source)).toEqual(convertSourceToCnoi(source));
    expect(JSON.stringify(source)).toBe(before);
    expect(
      body(source.sourceMarkdown.replace("Sample.", "Changed.")),
    ).toContain("Changed.");
    expect(source.sourceMarkdown).not.toContain("Changed.");
    expect(Object.keys(source).sort()).toEqual([
      "assets",
      "metadata",
      "sourceMarkdown",
      "warnings",
    ]);
  });
  it.each(["en", "ja", "other"] as const)(
    "does not invent Chinese titles for %s",
    (language) => {
      const result = body("Foreign original.\n", "luogu", language);
      expect(result).toContain("Foreign original.");
      expect(result).not.toMatch(/题目描述|样例|输入格式/);
    },
  );
  it("serializes an already transformed AST without a second semantic pass", () => {
    const ast = parseMarkdown("## User title\n\n### Input 42\n\nValue.\n").ast;
    const result = serializeMarkdown(ast.children);
    expect(parseMarkdown(result).ast).toEqual(ast);
    expect(result).toContain("### Input 42");
  });
  it("keeps a numbered sample group and the relationship of its child headings", () => {
    const result = body(
      "### Problem Statement\n\nText.\n\n### Example VII\n\n#### Input\n\n```\n1\n```\n\n#### Output\n\n```\n2\n```\n",
    );
    expect(result).toContain("## Example VII");
    expect(result).toContain("### Sample Input");
    expect(result).toContain("### Sample Output");
    expect(result).not.toContain("Input 1");
  });
  it("adjusts unknown main siblings together with known ones without changing their text", () => {
    const result = body(
      "### Problem Statement\n\nText.\n\n### Scoring and Interaction\n\nSpecial.\n\n#### Phase A\n\nDetails.\n\n### Input\n\nFormat.\n",
    );
    expect(result).toContain("## Scoring and Interaction");
    expect(result).toContain("### Phase A");
  });
  it("applies explicit rule configuration only in the Transformer", () => {
    const ast = parseMarkdown("### Input\n\nFormat.\n").ast;
    expect(
      serializeMarkdown(
        transformToCnoi(ast, metadata("qoj", "en"), { sectionLevel: 4 }).ast
          .children,
      ),
    ).toContain("#### Input");
    expect(ast.children[0]).toMatchObject({ level: 3 });
  });
  it("preserves Japanese sample identifiers when unwrapping an example group", () => {
    const result = body(
      "## Examples\n\n### **入力** #7\n\n```\n1\n```\n\n### 出力7\n\n```\n2\n```\n",
      "atcoder",
      "ja",
    );
    expect(result).toContain("## **入力例** #7");
    expect(result).toContain("## 出力例7");
    expect(result).not.toContain("7例");
  });
  it("uses source headings directly without native field containers", () => {
    const result = body("### 说明\n\n原始说明。\n", "luogu", "zh");
    expect(result).toBe("## 说明\n\n原始说明。\n");
    expect(result).not.toContain("说明/提示");
  });
  it("parses edited Markdown without restoring removed titles or renumbering", () => {
    const converted = convertSourceToCnoi({
      metadata: metadata("codeforces", "en"),
      sourceMarkdown: "## Examples\n\n### Input #7\n\n```\n1\n```\n",
      assets: [],
      warnings: [],
    });
    if (!converted.ok) throw new Error(converted.message);
    const edited = converted.value.cnoiMarkdown.replace(
      "## Sample Input #7",
      "# User Input #42",
    );
    const parsed = parseProblemMarkdown(edited, converted.value);
    expect(parsed.ok && serializeMarkdown(parsed.value.ast.children)).toContain(
      "# User Input #42",
    );
    expect(converted.value.cnoiMarkdown).toContain("#7");
  });
});
