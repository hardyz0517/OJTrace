import { describe, expect, it } from "vitest";
import { problemAdapterRegistry } from "../../src/problem/registry";
import { convertSourceToCnoi } from "../../src/problem/cnoi/convert";
import { inlineText } from "../../src/problem/markdown/text";
import { createSnapshot } from "./snapshot-fixtures";
import { sourceNodes } from "./source-test-helpers";

describe("source-only Adapter boundaries", () => {
  it("keeps explicit Luogu heading levels and author buttons instead of normalizing Source", async () => {
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url: "https://www.luogu.com.cn/problem/P1",
        html: '<h1>P1 Original</h1><article class="problem"><h2>输入输出样例</h2><div class="io-sample"><div class="io-sample-block"><h4>输入 #7</h4><pre>1</pre></div></div><p><button>Press this author button</button></p></article>',
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(sourceNodes(result.source)).toContainEqual(
      expect.objectContaining({ type: "heading", level: 4 }),
    );
    expect(result.source.sourceMarkdown).toContain("Press this author button");
  });
  it("keeps numbered QOJ body headings and author alert/download content", async () => {
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url: "https://qoj.ac/problem/1",
        html: '<h1 class="page-header">#1 Original</h1><div id="tab-statement"><article><h1>1. Definitions</h1><div class="alert">Author notice.</div><a class="btn" href="https://example.org/data.zip">Download input data.</a></article></div>',
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.source.sourceMarkdown).toContain("1. Definitions");
    expect(result.source.sourceMarkdown).toContain("Author notice.");
    expect(result.source.sourceMarkdown).toContain("Download input data.");
  });
  it("accepts an empty Hydro boolean marker on custom-domain fallback roots", async () => {
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url: "https://judge.example.org/d/course/p/P1",
        html: '<h1>Original Problem</h1><div class="problem-content" data-marker-enabled><h3>Input</h3><p>An original statement with enough content for the fallback source root.</p></div>',
      }),
    );
    expect(result.ok).toBe(true);
  });
  it.each([
    [
      "https://www.luogu.com.cn/problem/P1",
      '<h1>P1 Original</h1><article class="problem"><h3>Input</h3><p>Source format.</p></article>',
    ],
    [
      "https://codeforces.com/problemset/problem/1/A",
      '<div class="problem-statement"><div class="header"><div class="title">Original</div></div><h3>Input</h3><p>Source format.</p></div>',
    ],
    [
      "https://atcoder.jp/tasks/abc001_a?lang=en",
      '<span class="h2">Original</span><div id="task-statement"><h3>Input</h3><p>Source format.</p></div>',
    ],
    [
      "https://qoj.ac/problem/1",
      '<h1 class="page-header">#1 Original</h1><div id="tab-statement"><article><h3>Input</h3><p>Source format.</p></article></div>',
    ],
    [
      "https://hydro.ac/p/P1",
      '<h1>Original</h1><div data-fragment-id="problem-description"><h3>Input</h3><p>A complete original source format with enough descriptive content.</p></div>',
    ],
  ])(
    "exports only Markdown, metadata, resources and diagnostics: %s",
    async (url, html) => {
      const result = await problemAdapterRegistry.extractSource(
        createSnapshot({ url, html, title: "Original" }),
      );
      if (!result.ok) throw new Error(result.reason);
      expect(Object.keys(result.source).sort()).toEqual([
        "assets",
        "metadata",
        "sourceMarkdown",
        "warnings",
      ]);
      expect(result.source.metadata).not.toHaveProperty("blocks");
      expect(result.source.metadata).not.toHaveProperty("structure");
      expect(
        sourceNodes(result.source).find((node) => node.type === "heading"),
      ).toMatchObject({ level: 3 });
      expect(result.source.sourceMarkdown).not.toMatch(
        /sample-role|ojtrace-sample/,
      );
    },
  );
  it("infers a short native Chinese version from prose rather than generated HTML attributes", async () => {
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url: "https://www.luogu.com.cn/problem/P1",
        html: "<main></main>",
        sourceData: {
          luoguProblem: {
            name: "中文题目",
            content: { description: "计算两个数。" },
          },
        },
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.source.metadata.language).toBe("zh");
    const cnoi = convertSourceToCnoi(result.source);
    expect(cnoi.ok && cnoi.value.cnoiMarkdown).toContain("## 题目描述");
  });
  it("retains native blank lines and code that contains an anti-ai-like literal", async () => {
    const code = "```text\r\n::anti-ai[keep literal]\r\n\r\n\r\nend\r\n```";
    const description =
      "English statement. ::anti-ai[hidden prose]\r\n\r\n" +
      code +
      "\r\n\r\n`::anti-ai[inline literal]`";
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url: "https://www.luogu.com.cn/problem/SP1",
        html: "<main></main>",
        sourceData: {
          luoguProblem: {
            name: "Original",
            content: { description, locale: "en" },
          },
        },
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.source.sourceMarkdown).toContain(code);
    expect(result.source.sourceMarkdown).toContain(
      "`::anti-ai[inline literal]`",
    );
    expect(result.source.sourceMarkdown).not.toContain("hidden prose");
  });
  it("preserves noncontinuous DOM labels for native samples, including equal sample data", async () => {
    const html =
      '<main><h1>P1 中文题目</h1><article class="problem"><h2>输入输出样例</h2>' +
      [2, 7]
        .map(
          (id) =>
            `<div class="io-sample"><div class="io-sample-block"><p><b>输入 #${id}</b><button>复制</button></p><pre>1\n</pre></div><div class="io-sample-block"><p><b>输出 #${id}</b></p><pre>2\n</pre></div></div>`,
        )
        .join("") +
      "</article></main>";
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url: "https://www.luogu.com.cn/problem/P1",
        html,
        sourceData: {
          luoguProblem: {
            name: "中文题目",
            content: { description: "计算答案。", locale: "zh" },
            samples: [
              ["1\n", "2\n"],
              ["1\n", "2\n"],
            ],
          },
        },
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    const titles = sourceNodes(result.source).flatMap((node) =>
      node.type === "heading" ? [inlineText(node.children)] : [],
    );
    expect(titles).toEqual(
      expect.arrayContaining([
        "输入输出样例 #2",
        "输入 #2",
        "输出 #2",
        "输入输出样例 #7",
        "输入 #7",
        "输出 #7",
      ]),
    );
    expect(result.source.sourceMarkdown).not.toMatch(/^### \*\*/m);
    const cnoi = convertSourceToCnoi(result.source);
    if (!cnoi.ok) throw new Error(cnoi.message);
    expect(cnoi.value.cnoiMarkdown).toContain("#2");
    expect(cnoi.value.cnoiMarkdown).toContain("#7");
    expect(cnoi.value.cnoiMarkdown).not.toContain("#1");
  });
  it("preserves author note/warn blocks and notice-looking text after the body begins", async () => {
    const result = await problemAdapterRegistry.extractSource(
      createSnapshot({
        url: "https://hydro.ac/p/P1",
        html: '<h1>Original</h1><div data-fragment-id="problem-description"><blockquote class="warn"><p>Author constraints and warnings are part of this problem.</p></blockquote><p>Read the original author content carefully.</p><blockquote class="note"><p>The contest is ended. This is a quotation in the statement.</p></blockquote></div>',
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.source.sourceMarkdown).toContain(
      "Author constraints and warnings",
    );
    expect(result.source.sourceMarkdown).toContain(
      "quotation in the statement",
    );
  });
});
