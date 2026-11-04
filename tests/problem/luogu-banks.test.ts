import { serializeMarkdown } from "../../src/problem/markdown/serialize";
import { sourceNodes } from "./source-test-helpers";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { luoguProblemAdapter } from "../../src/problem/adapters/luogu";
import { problemAdapterRegistry } from "../../src/problem/registry";
import { convertSourceToCnoi } from "../../src/problem/cnoi/convert";
import { inlineText } from "../../src/problem/markdown/text";
import { createProbe, createSnapshot } from "./snapshot-fixtures";
import { parseProblemMarkdown } from "../../src/problem/problem-markdown";

function page(id: string): string {
  return `<main><h1>${id} 全题库回归</h1><article class="problem"><h2>题目描述</h2><p>计算 $a+b$。</p><h3>输入 #1</h3><pre>1 2</pre><h3>输出 #1</h3><pre>3</pre></article></main>`;
}

describe("Luogu problem-bank routes", () => {
  it.each([
    "P1001",
    "B2001",
    "U123456",
    "T123456",
    "CF1A",
    "CF1936C",
    "SP1",
    "UVA100",
    "AT_abc175_f",
    "AT_abc123_Ex",
    "AT1234",
    "NEWBANK_2026_a",
  ])(
    "recognizes and extracts the complete id %s in modern and legacy routes",
    async (id) => {
      for (const url of [
        `https://www.luogu.com.cn/problem/${id}`,
        `https://www.luogu.com.cn/problem/${id}/?contestId=42#submit`,
        `https://www.luogu.com.cn/problem/show?foo=1&pid=${id}`,
      ]) {
        expect(problemAdapterRegistry.find(url)).toBe(luoguProblemAdapter);
        expect(
          problemAdapterRegistry.captureHints(url)?.jsonScripts,
        ).toHaveLength(2);
        const preview = await problemAdapterRegistry.inspect(
          createProbe({
            url,
            html: page(id),
            title: `${id} 全题库回归 - 洛谷`,
          }),
        );
        expect(preview).toMatchObject({
          oj: "luogu",
          problemId: id,
          title: "全题库回归",
          originalUrl: url,
        });
        const result = await problemAdapterRegistry.extractSource(
          createSnapshot({ url, html: page(id) }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.reason);
        expect(result.source.metadata.problemId).toBe(id);
        expect(result.source.sourceMarkdown).toContain("$a+b$");
        expect(
          sourceNodes(result.source).filter((block) => block.type === "code"),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ value: "1 2" }),
            expect.objectContaining({ value: "3" }),
          ]),
        );
      }
    },
  );

  it.each([
    "https://www.luogu.com.cn/problem/list",
    "https://www.luogu.com.cn/problem/new",
    "https://www.luogu.com.cn/problem/show",
    "https://www.luogu.com.cn/problem/list?pid=AT_abc175_f",
    "https://www.luogu.com.cn/user/123?pid=CF1A",
    "https://www.luogu.com.cn/problem/AT_abc175_f/solution",
    "https://www.luogu.com.cn/problem/solution/CF1A",
    "https://www.luogu.com.cn/contest/123/problem/CF1A",
    "https://www.luogu.com.cn/problem/AT_abc175_f%2Fsolution",
    "https://www.luogu.com.cn/problem/AT_abc175_f%3Fpid=CF1A",
    "https://www.luogu.com.cn/problem/AT_%ZZ",
    "https://www.luogu.com.cn/problem/show?pid=CF1A&pid=SP1",
    "https://www.luogu.com.cn.evil.example/problem/CF1A",
    "https://evilluogu.com.cn/problem/CF1A",
    "https://atcoder.jp/problem/AT_abc175_f",
    "ftp://www.luogu.com.cn/problem/CF1A",
  ])("does not mistake a non-statement URL for a Luogu problem: %s", (url) => {
    expect(luoguProblemAdapter.match(url)).toBe(false);
  });

  it("decodes a problem segment once and never overrides it with an unrelated pid query", async () => {
    const url = "https://www.luogu.com.cn/problem/%41T_abc175_f?pid=CF1A";
    const preview = await problemAdapterRegistry.inspect(
      createProbe({ url, html: page("AT_abc175_f") }),
    );
    expect(preview?.problemId).toBe("AT_abc175_f");
  });
});

describe("captured Luogu remote-judge statements", () => {
  it.each([true, false])(
    "retains native export groups or DOM sample hierarchy for CF1209F (native fields: %s)",
    async (native) => {
      const html = readFileSync(
        new URL(
          "../../docs/fixtures/problem/luogu-cf1209f-samples.html",
          import.meta.url,
        ),
        "utf8",
      );
      const context = JSON.parse(
        html.match(
          /<script[^>]*id="lentille-context"[^>]*>([\s\S]*?)<\/script>/i,
        )![1]!,
      ) as { data: { problem: { samples: string[][] } } };
      const result = await problemAdapterRegistry.extractSource(
        createSnapshot({
          url: "https://www.luogu.com.cn/problem/CF1209F",
          html,
          ...(native
            ? { sourceData: { luoguProblem: context.data.problem } }
            : {}),
        }),
      );
      if (!result.ok) throw new Error(result.reason);
      const source = result.source;
      const original = JSON.stringify(source);
      if (native) {
        expect(source.sourceMarkdown.match(/^## 输入输出样例 #\d+$/gm)).toEqual(
          [1, 2, 3].map((id) => `## 输入输出样例 #${id}`),
        );
        expect(source.sourceMarkdown).not.toMatch(/^## 输入输出样例$/m);
        expect(source.sourceMarkdown).not.toMatch(/^### \*\*/m);
      } else {
        expect(source.sourceMarkdown.match(/^## 输入输出样例$/gm)).toHaveLength(
          1,
        );
      }
      const copiedTitles = sourceNodes(source).filter(
        (block) => block.type === "heading",
      );
      expect(
        copiedTitles
          .filter((block) =>
            /^(?:输入|输出) #\d+$/.test(inlineText(block.children)),
          )
          .map((block) => [block.level, inlineText(block.children)]),
      ).toEqual(
        [1, 2, 3].flatMap((number) =>
          ["输入", "输出"].map((part) => [3, `${part} #${number}`]),
        ),
      );
      const converted = convertSourceToCnoi(source);
      if (!converted.ok) throw new Error(converted.message);
      const parsed = parseProblemMarkdown(
        converted.value.cnoiMarkdown,
        converted.value,
      );
      if (!parsed.ok) throw new Error(parsed.message);
      expect(
        parsed.value.ast.children.filter(
          (block) =>
            block.type === "heading" &&
            inlineText(block.children) === "输入输出样例",
        ),
      ).toEqual([]);
      const codes = parsed.value.ast.children.filter(
        (block) => block.type === "code",
      );
      expect(codes).toHaveLength(6);
      context.data.problem.samples.forEach((sample, index) => {
        expect(codes[index * 2]?.value).toBe(
          native ? sample[0] : sample[0]?.replace(/\n$/, ""),
        );
        expect(codes[index * 2 + 1]?.value).toBe(
          native ? sample[1] : sample[1]?.replace(/\n$/, ""),
        );
      });
      const titles = parsed.value.ast.children.filter(
        (block) => block.type === "heading",
      );
      for (const number of [1, 2, 3])
        for (const part of ["输入", "输出"]) {
          expect(
            titles.some(
              (title) =>
                title.level === 2 &&
                inlineText(title.children).endsWith(`${part} #${number}`),
            ),
          ).toBe(true);
        }
      expect(JSON.stringify(source)).toBe(original);
    },
  );
  it.each([
    [
      "atcoder",
      "AT_abc175_f",
      "[ABC175F] Making Palindrome",
      4,
      "zh",
      "有 $N$ 个仅含小写字母的字符串",
    ],
    ["codeforces", "CF1A", "Theatre Square", 1, "zh", "剧院广场呈矩形"],
    [
      "spoj",
      "SP1",
      "TEST - Life, the Universe, and Everything",
      1,
      "en",
      "find the Answer to Life",
    ],
    ["uva", "UVA100", "The 3n + 1 problem", 1, "zh", "考虑下面的程序"],
  ] as const)(
    "exports the captured %s statement, samples and editable metadata",
    async (bank, id, title, sampleCount, language, content) => {
      const html = readFileSync(
        new URL(
          `../../docs/fixtures/problem/luogu-bank-${bank}.html`,
          import.meta.url,
        ),
        "utf8",
      );
      const context = JSON.parse(
        html.match(
          /<script[^>]*id="lentille-context"[^>]*>([\s\S]*?)<\/script>/i,
        )![1]!,
      ) as { data: { problem: Record<string, unknown> } };
      const url = `https://www.luogu.com.cn/problem/${id}`;
      const preview = await problemAdapterRegistry.inspect(
        createProbe({ url, html }),
      );
      expect(preview).toMatchObject({ oj: "luogu", problemId: id, title });
      const result = await problemAdapterRegistry.extractSource(
        createSnapshot({
          url,
          html,
          sourceData: { luoguProblem: context.data.problem },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      expect(result.source.metadata).toMatchObject({
        oj: "luogu",
        problemId: id,
        originalUrl: url,
        title,
        language,
      });
      expect(
        sourceNodes(result.source).filter((block) => block.type === "code"),
      ).toHaveLength(sampleCount * 2);
      expect(result.source.sourceMarkdown).toContain(content);
      expect(result.source.metadata.timeLimit?.milliseconds).toBeGreaterThan(0);
      const prepared = convertSourceToCnoi(result.source);
      if (!prepared.ok) throw new Error(prepared.message);
      const edited = parseProblemMarkdown(
        prepared.value.cnoiMarkdown,
        prepared.value,
      );
      expect(edited.ok).toBe(true);
      if (edited.ok) {
        expect(edited.value).toMatchObject({
          problemId: id,
          title,
          originalUrl: url,
        });
        expect(serializeMarkdown(edited.value.ast.children)).toContain(content);
      }
      if (bank === "atcoder") {
        expect(result.source.metadata.timeLimit?.milliseconds).toBe(2000);
        expect(result.source.metadata.memoryLimit?.bytes).toBe(1024 ** 3);
        expect(result.source.sourceMarkdown).not.toContain(
          "高橋君はまずこれら",
        );
        expect(result.source.sourceMarkdown).toContain("### 样例解释");
        expect(result.source.sourceMarkdown).not.toContain(
          "Sample Explanation 1",
        );
        expect(result.source.sourceMarkdown).not.toContain("## 说明/提示");
      }
    },
  );

  it("ignores a structured record belonging to a different complete problem id", async () => {
    const url = "https://www.luogu.com.cn/problem/AT_abc175_f";
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url,
        html: page("AT_abc175_f"),
        sourceData: {
          luoguProblem: {
            pid: "AT_abc175_e",
            name: "Wrong problem",
            description: "Wrong statement",
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.metadata.problemId).toBe("AT_abc175_f");
      expect(result.source.sourceMarkdown).not.toContain("Wrong statement");
    }
  });
});

describe("Luogu statement language isolation", () => {
  const url = "https://www.luogu.com.cn/problem/AT_abc175_f";
  const original = {
    name: "Original title",
    background: "日本語の背景",
    description: "日本語の本文",
    formatI: "日本語の入力",
    formatO: "日本語の出力",
    hint: "日本語のヒント",
    locale: "ja",
  };
  const translated = {
    name: "中文题目",
    description: "中文正文。",
    inputFormat: "中文输入。",
    outputFormat: "中文输出。",
    locale: "zh-CN",
  };

  it.each([undefined, null, "", " \n\t"])(
    "preserves an empty translated background/hint (%j) without borrowing original or flat fields",
    async (empty) => {
      for (const sourceKey of ["luoguProblem", "luoguProblemCurrent"]) {
        const result = await problemAdapterRegistry.extractSource(
          createSnapshot({
            url,
            html: page("AT_abc175_f"),
            sourceData: {
              [sourceKey]: {
                pid: "AT_abc175_f",
                background: "Flat original background",
                hint: "Flat original hint",
                content: original,
                contenu: {
                  ...translated,
                  ...(empty !== undefined
                    ? { background: empty, hint: empty }
                    : {}),
                },
                samples: [["1", "2"]],
                limits: { time: [2000], memory: [1048576] },
              },
            },
          }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.reason);
        expect(result.source.metadata).toMatchObject({
          title: "中文题目",
          language: "zh",
          timeLimit: { milliseconds: 2000 },
          memoryLimit: { bytes: 1024 ** 3 },
        });
        expect(result.source.sourceMarkdown).toContain("中文正文。");
        expect(result.source.sourceMarkdown).toContain("中文输入。");
        expect(result.source.sourceMarkdown).toContain("中文输出。");
        expect(result.source.sourceMarkdown).not.toMatch(
          /日本語|Flat original|题目背景|说明\/提示/,
        );
        expect(
          sourceNodes(result.source).filter((block) => block.type === "code"),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ value: "1" }),
            expect.objectContaining({ value: "2" }),
          ]),
        );
      }
    },
  );

  it("does not borrow missing translated input/output sections from the original", async () => {
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url,
        html: page("AT_abc175_f"),
        sourceData: {
          luoguProblem: {
            content: original,
            contenu: { description: "中文正文。", locale: "zh-CN" },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(
      sourceNodes(result.source).filter((block) => block.type === "paragraph"),
    ).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "中文正文。" }] },
    ]);
    expect(JSON.stringify(convertSourceToCnoi(result.source))).toContain(
      "## 题目描述",
    );
  });

  it("preserves a translated hint when that version actually provides one", async () => {
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url,
        html: page("AT_abc175_f"),
        sourceData: {
          luoguProblem: {
            content: original,
            contenu: { ...translated, hint: "中文提示。" },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.source.sourceMarkdown).toContain("中文提示。");
    expect(result.source.sourceMarkdown).toContain("## 说明/提示");
    expect(result.source.sourceMarkdown).not.toContain("日本語");
  });

  it.each(["luoguProblem", "luoguProblemCurrent"])(
    "keeps the complete translation in %s when another payload has a longer original",
    async (sourceKey) => {
      const otherKey =
        sourceKey === "luoguProblem" ? "luoguProblemCurrent" : "luoguProblem";
      const result = await problemAdapterRegistry.extractSource(
        createSnapshot({
          url,
          html: page("AT_abc175_f"),
          sourceData: {
            [sourceKey]: { content: original, contenu: translated },
            [otherKey]: {
              content: {
                ...original,
                description: original.description.repeat(100),
              },
            },
          },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      expect(result.source.metadata.language).toBe("zh");
      expect(result.source.sourceMarkdown).toContain("中文正文。");
      expect(result.source.sourceMarkdown).not.toContain("日本語");
    },
  );

  it.each([undefined, null])(
    "keeps the complete original, including its hint, when translation is absent (%j)",
    async (contenu) => {
      const result = await problemAdapterRegistry.extractSource(
        createSnapshot({
          url,
          html: page("AT_abc175_f"),
          sourceData: { luoguProblem: { content: original, contenu } },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      expect(result.source.metadata.language).toBe("ja");
      expect(result.source.sourceMarkdown).toContain("日本語の本文");
      expect(result.source.sourceMarkdown).toContain("日本語のヒント");
      expect(result.source.sourceMarkdown).not.toContain("中文正文");
    },
  );
});
