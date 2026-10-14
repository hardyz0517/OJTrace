import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { luoguProblemAdapter } from "../../src/problem/adapters/luogu";
import {
  extractProblemPage,
  inspectProblemPage,
} from "../../src/problem/registry";
import { createProbe, createSnapshot } from "../../src/problem/snapshot";

describe("problem page adapters", () => {
  it("extracts a Codeforces statement into canonical blocks", async () => {
    const url = "https://codeforces.com/problemset/problem/1/A";
    const html = `<div class="problem-statement"><div class="header"><div class="title">A. Theatre Square</div><div class="time-limit">time limit per test: 1 second</div><div class="memory-limit">memory limit per test: 64 megabytes</div></div><div class="problem-statement"><div class="input"><div class="title">Input</div><pre><div class="test-example-line">2 3</div></pre></div><div class="output"><div class="title">Output</div><pre><div class="test-example-line">2</div></pre></div><p>Find <span class="tex-span" data-math="n^2">n^2</span>.</p></div></div>`;
    const preview = await inspectProblemPage(
      createProbe({ url, html, title: "A. Theatre Square" }),
    );
    expect(preview?.oj).toBe("codeforces");
    expect(preview?.problemId).toBe("1A");
    const result = await extractProblemPage(
      createSnapshot({ url, html, title: "A. Theatre Square" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.title).toContain("Theatre Square");
      expect(result.document.problemId).toBe("1A");
      expect(result.document.timeLimit).toEqual({
        display: "1 second",
        milliseconds: 1_000,
      });
      expect(result.document.memoryLimit).toEqual({
        display: "64 megabytes",
        bytes: 64 * 1024 ** 2,
      });
      expect(result.document.markdown).not.toContain("Theatre Square");
      expect(result.document.markdown).not.toContain("time limit per test");
      expect(result.document.markdown).not.toContain("memory limit per test");
      expect(
        result.document.blocks.some((block) => block.type === "sample"),
      ).toBe(true);
      expect(result.document.markdown).toContain("```text");
    }
  });

  it("keeps Codeforces limit quantities and drops the injected copy control", async () => {
    const url = "https://codeforces.com/problemset/problem/5/E";
    const html = `<div class="problem-statement"><div class="header"><div class="title">E. Bindian Signalizing</div><div class="time-limit"><div class="property-title">time limit per test</div>4 seconds</div><div class="memory-limit"><div class="property-title">memory limit per test</div>256 megabytes</div></div><div><p>Watchmen stand on hills.</p><center><img class="tex-graphics" src="https://espresso.codeforces.com/diagram.png" /></center></div><div class="sample-tests"><div class="section-title">Examples</div><div class="sample-test"><div class="input"><div class="title">Input<div class="input-output-copier" title="Copy" data-clipboard-target="#pre1">Copy</div></div><pre>5
1 2 4 5 3
</pre></div><div class="output"><div class="title">Output<div class="input-output-copier">Copy</div></div><pre>7
</pre></div></div></div></div>`;
    const result = await extractProblemPage(
      createSnapshot({ url, html, title: "E. Bindian Signalizing" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.timeLimit).toEqual({
      display: "4 seconds",
      milliseconds: 4_000,
    });
    expect(result.document.memoryLimit).toEqual({
      display: "256 megabytes",
      bytes: 256 * 1024 ** 2,
    });
    expect(result.document.markdown).not.toContain("Copy");
    expect(result.document.markdown).not.toContain("time limit per test");
    const sample = result.document.blocks.find(
      (block) => block.type === "sample",
    );
    expect(sample).toMatchObject({
      type: "sample",
      input: { value: "5\n1 2 4 5 3" },
      output: { value: "7" },
    });
    expect(result.document.assets.map((asset) => asset.sourceUrl)).toContain(
      "https://espresso.codeforces.com/diagram.png",
    );
  });

  it("supports AtCoder language-aware task pages", async () => {
    const url = "https://atcoder.jp/contests/abc001/tasks/abc001_1?lang=en";
    const html = `<div id="task-statement"><h2>ABC001 A - Hello World</h2><p>Time Limit: 2 sec</p><p>Memory Limit: 1024 MiB</p><h3>Sample Input 1</h3><pre>1</pre><h3>Sample Output 1</h3><pre>1</pre></div>`;
    const result = await extractProblemPage(
      createSnapshot({ url, html, title: "ABC001 A" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.language).toBe("en");
      expect(result.document.problemId).toBe("abc001_1");
    }
  });

  it("parses Japanese AtCoder limits and preserves the selected language", async () => {
    const url = "https://atcoder.jp/contests/abc001/tasks/abc001_1?lang=ja";
    const html = `<html lang="ja"><div id="task-statement"><h2>ABC001 A - はじめての問題</h2><p>整数を出力してください。</p></div><p>実行時間制限: 2 sec / メモリ制限: 1024 MB</p></html>`;
    const result = await extractProblemPage(
      createSnapshot({ url, html, title: "ABC001 A", language: "ja" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.language).toBe("ja");
      expect(result.document.timeLimit).toEqual({
        display: "2 sec",
        milliseconds: 2_000,
      });
      expect(result.document.memoryLimit).toEqual({
        display: "1024 MB",
        bytes: 1024 * 1024 ** 2,
      });
    }
  });

  it("drops AtCoder contest score and keeps each rendered formula once", async () => {
    const katexVar = (tex: string, visual: string): string =>
      `<var><span class="katex"><span class="katex-mathml"><math><semantics><mrow>${visual}</mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${visual}</span></span></var>`;
    const score = katexVar("450", "450");
    const variable = katexVar("N", "N");
    const limit = katexVar(String.raw`2 \leq N \leq 400`, "2≤N≤400");
    const page = (shown: "ja" | "en") => {
      const style = (language: "ja" | "en") =>
        ` style="display: ${shown === language ? "inline" : "none"}"`;
      return `<span class="h2">E - Sightseeing Tour <a href="/editorial">Editorial</a></span><p>Time Limit: 4 sec / Memory Limit: 1024 MiB</p><div id="task-statement"><span class="lang"><span class="lang-ja"${style("ja")}><p>配点 : ${score} 点</p><h3>問題文</h3><p>${variable} 個の島と ${limit}。</p><p>この説明は残す。</p><h3>入力</h3><pre>${variable} ${katexVar("M", "M")}</pre></span><span class="lang-en"${style("en")}><p>Score : ${score} points</p><p>${variable} islands.</p></span></span></div>`;
    };

    const japanese = await extractProblemPage(
      createSnapshot({
        url: "https://atcoder.jp/contests/abc999/tasks/abc999_e?lang=ja",
        html: page("ja"),
        title: "E - Sightseeing Tour",
      }),
    );
    const english = await extractProblemPage(
      createSnapshot({
        url: "https://atcoder.jp/contests/abc999/tasks/abc999_e?lang=en",
        html: page("en"),
        title: "E - Sightseeing Tour",
      }),
    );

    expect(japanese.ok).toBe(true);
    if (japanese.ok) {
      expect(japanese.document.markdown).toContain("$N$");
      expect(japanese.document.markdown).toContain(
        String.raw`$2 \leq N \leq 400$`,
      );
      expect(japanese.document.markdown).toContain("この説明は残す");
      expect(japanese.document.markdown).not.toMatch(/配点\s*[:：]/);
      expect(japanese.document.markdown).not.toContain("450");
      expect(japanese.document.markdown).not.toContain("NNN");
      expect(japanese.document.markdown).not.toContain("islands");
      expect(
        japanese.document.blocks.find((block) => block.type === "sample"),
      ).toMatchObject({ input: { value: "N M" } });
    }
    expect(english.ok).toBe(true);
    if (english.ok) {
      expect(english.document.markdown).toContain("$N$ islands.");
      expect(english.document.markdown).not.toMatch(/Score\s*:/i);
      expect(english.document.markdown).not.toContain("450");
      expect(english.document.markdown).not.toContain("個の島");
    }
  });

  it("follows the AtCoder language that is actually displayed", async () => {
    const page = (ja: string, en: string) =>
      `<div id="task-statement"><span class="lang"><span class="lang-ja"${ja}><p>日本語の本文</p></span><span class="lang-en"${en}><p>English statement</p></span></span></div>`;
    const extract = (url: string, html: string) =>
      extractProblemPage(
        createSnapshot({
          url,
          html,
          title: "D - Restoring Road Network",
        }),
      );
    const task = "https://atcoder.jp/contests/abc074/tasks/arc083_b";
    const displayed = await extract(
      `${task}?lang=ja`,
      page(' style="display: none"', ' style="display: inline"'),
    );
    expect(displayed.ok).toBe(true);
    if (displayed.ok) {
      expect(displayed.document.language).toBe("en");
      expect(displayed.document.markdown).toContain("English statement");
      expect(displayed.document.markdown).not.toContain("日本語の本文");
    }
    const ambiguous = await extract(`${task}?lang=en`, page("", ""));
    expect(ambiguous.ok).toBe(true);
    if (ambiguous.ok) {
      expect(ambiguous.document.language).toBe("en");
      expect(ambiguous.document.markdown).toContain("English statement");
      expect(ambiguous.document.markdown).not.toContain("日本語の本文");
    }
    const onlyEnglish = await extract(
      `${task}?lang=ja`,
      `<div id="task-statement"><span class="lang"><span class="lang-en"><p>English statement</p></span></span></div>`,
    );
    expect(onlyEnglish.ok).toBe(true);
    if (onlyEnglish.ok) expect(onlyEnglish.document.language).toBe("en");
  });

  it("drops AtCoder section rules between samples", async () => {
    const url = "https://atcoder.jp/contests/abc074/tasks/arc083_b?lang=en";
    const html = `<div id="task-statement"><span class="lang"><span class="lang-en" style="display: inline"><div class="part"><section><h3>Outputs</h3><p>Print the answer.</p></section></div><hr /><div class="part"><section><h3>Sample Input 1</h3><pre>1 2</pre></section></div><div class="part"><section><h3>Sample Output 1</h3><pre>3</pre></section></div><hr /><div class="part"><section><h3>Sample Input 2</h3><pre>4</pre></section></div><hr /><div class="part"><section><h3>Sample Output 2</h3><pre>5</pre></section></div></span></span></div>`;
    const result = await extractProblemPage(
      createSnapshot({
        url,
        html,
        title: "D - Restoring Road Network",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.language).toBe("en");
    expect(result.document.markdown).toContain("Print the answer.");
    expect(result.document.markdown).toContain("### Sample Input 1");
    expect(result.document.markdown).toContain("### Sample Output 2");
    expect(result.document.markdown).not.toContain("**输入**");
    expect(result.document.markdown).not.toContain("**输出**");
    expect(result.document.markdown).not.toMatch(/^---$/m);
    expect(
      result.document.blocks.some((block) => block.type === "thematic-break"),
    ).toBe(false);
    expect(
      result.document.blocks.filter((block) => block.type === "sample"),
    ).toMatchObject([
      {
        type: "sample",
        input: { type: "code", value: "1 2" },
        output: { type: "code", value: "3" },
      },
      {
        type: "sample",
        input: { type: "code", value: "4" },
        output: { type: "code", value: "5" },
      },
    ]);
  });

  it("uses the captured document language for AtCoder pages without lang query", async () => {
    const url = "https://atcoder.jp/contests/abc001/tasks/abc001_1";
    const html = `<html lang="en"><div id="task-statement"><h2>ABC001 A - Hello World</h2><p>Time Limit: 2 sec</p><p>Memory Limit: 1024 MiB</p><p>Print a greeting.</p></div></html>`;
    const result = await extractProblemPage(
      createSnapshot({ url, html, title: "ABC001 A", language: "en" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.language).toBe("en");
  });

  it("uses AtCoder's outer title and only the selected language variant", async () => {
    const url = "https://atcoder.jp/contests/abc372/tasks/abc372_a?lang=en";
    const html = readFileSync(
      new URL(
        "../../docs/fixtures/problem/atcoder-multilang.html",
        import.meta.url,
      ),
      "utf8",
    );
    const result = await extractProblemPage(
      createSnapshot({ url, html, title: "A - delete . - AtCoder" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.title).toBe("A - delete .");
      expect(result.document.language).toBe("en");
      expect(result.document.markdown).toContain("English statement");
      expect(result.document.markdown).not.toContain("日本語の本文");
      expect(result.document.markdown).not.toContain("Editorial");
      expect(result.document.timeLimit?.milliseconds).toBe(2_000);
      expect(result.document.memoryLimit?.bytes).toBe(1024 * 1024 ** 2);
    }
  });

  it("does not treat an unsupported page as a problem", async () => {
    const preview = await inspectProblemPage(
      createProbe({
        url: "https://example.com/problem/1",
        html: "<main><h1>Example</h1></main>",
      }),
    );
    expect(preview).toBeUndefined();
  });

  it("recognizes Luogu, QOJ, and HydroOJ statement routes", async () => {
    const cases = [
      {
        oj: "luogu",
        url: "https://www.luogu.com.cn/problem/P1001",
        html: `<main><h1>P1001 A+B Problem</h1><article class="markdown-body"><h2>题目描述</h2><p>计算两个整数的和。</p><h2>输入</h2><pre>1 2</pre></article></main>`,
      },
      {
        oj: "qoj",
        url: "https://qoj.ac/problem/1",
        html: `<h1>A+B</h1><div class="uoj-content"><p>Calculate the sum of two integers.</p><h2>Input</h2><pre>1 2</pre></div>`,
      },
      {
        oj: "hydroj",
        url: "https://hydro.ac/p/123",
        html: `<main><h1>#123. A+B</h1><div class="problem-content-container"><div class="problem-content" data-marker-enabled><div class="section__body typo richmedia" data-fragment-id="problem-description"><p>Calculate the sum of two integers for this problem statement.</p><h2>Input</h2><pre>1 2</pre></div></div></div></main>`,
      },
    ] as const;
    for (const item of cases) {
      const preview = await inspectProblemPage(
        createProbe({ url: item.url, html: item.html, title: "A+B" }),
      );
      expect(preview?.oj).toBe(item.oj);
      const result = await extractProblemPage(
        createSnapshot({ url: item.url, html: item.html, title: "A+B" }),
      );
      expect(result.ok).toBe(true);
    }
  });

  it("extracts the current Luogu card layout and its canonical JSON statement", async () => {
    const url = "https://www.luogu.com.cn/problem/P1001";
    const html = readFileSync(
      new URL(
        "../../docs/fixtures/problem/luogu-current.html",
        import.meta.url,
      ),
      "utf8",
    );
    const sourceScript = html.match(
      /<script id="lentille-context" type="application\/json">([\s\S]*?)<\/script>/i,
    )?.[1];
    expect(sourceScript).toBeDefined();
    const context = JSON.parse(sourceScript ?? "{}") as {
      data?: { problem?: Record<string, unknown> };
    };
    const result = await extractProblemPage(
      createSnapshot({
        url,
        html,
        title: "P1001 A+B Problem - 洛谷",
        sourceData: { luoguProblem: context.data?.problem },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.title).toBe("A+B Problem");
    expect(result.document.timeLimit?.milliseconds).toBe(1_000);
    expect(result.document.memoryLimit?.bytes).toBe(512 * 1024 ** 2);
    expect(result.document.markdown).toContain("不能有多余的内容");
    expect(result.document.markdown).toContain("$a+b$");
    expect(result.document.markdown).toContain("对于所有测试数据");
    expect(result.document.blocks).toContainEqual(
      expect.objectContaining({
        type: "sample",
        input: expect.objectContaining({ value: "20 30" }),
        output: expect.objectContaining({ value: "50" }),
      }),
    );
    expect(result.document.markdown).not.toContain("复制题目");
    expect(result.document.markdown).not.toContain("sidebar");
    expect(result.document.markdown).toContain("### 输入 #1");
    expect(result.document.markdown).toContain("### 输出 #1");
    expect(result.document.markdown).not.toContain("**输入 #1**");
    expect(result.document.markdown).not.toContain("样例 1 输入");
  });

  it("reads the QOJ statement article instead of the page shell", async () => {
    const url = "https://qoj.ac/problem/11";
    const html = readFileSync(
      new URL("../../docs/fixtures/problem/qoj-uoj.html", import.meta.url),
      "utf8",
    );
    const preview = await inspectProblemPage(
      createProbe({ url, html, title: "矩阵变换 - 题目 - QOJ.ac" }),
    );
    expect(preview?.title).toBe("矩阵变换");
    const result = await extractProblemPage(
      createSnapshot({ url, html, title: "矩阵变换 - 题目 - QOJ.ac" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.problemId).toBe("11");
    expect(result.document.title).toBe("矩阵变换");
    expect(result.document.timeLimit).toEqual({
      display: "1 s",
      milliseconds: 1_000,
    });
    expect(result.document.memoryLimit).toEqual({
      display: "512 MB",
      bytes: 512 * 1024 ** 2,
    });
    expect(result.document.markdown).toContain("给出一个");
    expect(result.document.markdown).toContain("5 10");
    expect(result.document.markdown).toContain("4 5 3 1 2");
    expect(result.document.markdown).toContain("**说明**");
    expect(result.document.markdown).not.toContain("explanation");
    expect(
      result.document.blocks.some((block) => block.type === "sample"),
    ).toBe(true);
    for (const noise of [
      "QOJ.ac",
      "[+36]",
      "统计",
      "语言",
      "自定义测试",
      "讨论与问题",
      "该题目在以下比赛中使用过",
      "CTT 2014",
      "总分",
      "难度",
      "[显示]",
      "提交源文件",
      "时间限制",
      "内存限制",
    ]) {
      expect(result.document.markdown).not.toContain(noise);
    }
  });

  it("recognizes QOJ contest problem routes", async () => {
    const url = "https://qoj.ac/contest/179/problem/11";
    const html = readFileSync(
      new URL("../../docs/fixtures/problem/qoj-uoj.html", import.meta.url),
      "utf8",
    );
    const preview = await inspectProblemPage(
      createProbe({ url, html, title: "矩阵变换 - 题目 - QOJ.ac" }),
    );
    expect(preview?.oj).toBe("qoj");
    expect(preview?.problemId).toBe("11");
    expect(preview?.title).toBe("矩阵变换");
  });

  it("does not identify arbitrary /p routes as HydroOJ without Hydro statement markers", async () => {
    const url = "https://unrelated.example/p/123";
    const html = `<main><h1>A+B</h1><article><p>This is a long generic page with enough content to satisfy a shallow text-length check.</p></article></main>`;
    expect(
      await inspectProblemPage(createProbe({ url, html, title: "A+B" })),
    ).toBeUndefined();
    const result = await extractProblemPage(createSnapshot({ url, html }));
    expect(result).toEqual({ ok: false, reason: "statement-not-found" });
  });

  it("does not treat a generic QOJ content container or login page as a statement", async () => {
    const url = "https://qoj.ac/problem/404";
    const generic = await inspectProblemPage(
      createProbe({
        url,
        html: `<main><div class="content"><h1>Not a statement</h1><p>Sign in to continue.</p></div></main>`,
        title: "QOJ",
      }),
    );
    expect(generic).toBeUndefined();
    const challenge = await extractProblemPage(
      createSnapshot({
        url,
        html: `<html><head><title>Access denied - QOJ</title></head><body><p>Access denied</p><form><label>Username</label><input name="username"><label>Password</label><input type="password"></form></body></html>`,
      }),
    );
    expect(challenge).toEqual({ ok: false, reason: "challenge-page" });
  });

  it("recognizes custom Hydro instances only when their statement marker exists", async () => {
    const url = "https://school-oj.example/d/school/p/321";
    const html = `<main><h1>#321. Geometry</h1><div class="problem-content" data-marker-enabled><div data-fragment-id="problem-description"><p>This statement belongs to a Hydro instance with a custom origin and domain.</p></div></div></main>`;
    const preview = await inspectProblemPage(
      createProbe({ url, html, title: "Geometry" }),
    );
    expect(preview?.oj).toBe("hydroj");
    expect(preview?.problemId).toBe("321");
    const result = await extractProblemPage(createSnapshot({ url, html }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.originalUrl).toBe(url);
  });

  it("omits Hydro system callouts and keeps statement code and merged cells", async () => {
    const url = "https://hydro.ac/contest/9/problem/graph";
    const html = `<main><h1 class="section__title">C. graph</h1>
      <span class="problem__tag-item icon icon-stopwatch">2000ms</span>
      <span class="problem__tag-item icon icon-comparison">512MiB</span>
      <div class="problem-content" data-marker-enabled>
        <div data-fragment-id="problem-description">
          <blockquote class="note"><p>CONTEST_ENDED_NOTICE</p></blockquote>
          <blockquote class="warn"><p>NO_TESTDATA_WARNING</p></blockquote>
          <blockquote><p>Author note stays in the statement.</p></blockquote>
          <p>See <code>down/graph/</code> for the rest of this Hydro statement.</p>
          <table>
            <thead><tr><th colspan="2">Group</th><th>Limit</th></tr></thead>
            <tbody>
              <tr><td rowspan="2">1</td><td>11</td><td>none</td></tr>
              <tr><td>12</td><td>tight</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>`;
    const result = await extractProblemPage(
      createSnapshot({ url, html, title: "C. graph" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.timeLimit?.display).toBe("2000ms");
    expect(result.document.memoryLimit?.display).toBe("512MiB");
    expect(result.document.markdown).not.toContain("CONTEST_ENDED_NOTICE");
    expect(result.document.markdown).not.toContain("NO_TESTDATA_WARNING");
    expect(result.document.markdown).toContain("Author note stays");
    expect(result.document.markdown).toContain("`down/graph/`");
    const table = result.document.blocks.find(
      (block) => block.type === "table",
    );
    expect(table).toMatchObject({
      type: "table",
      spans: [
        [
          { colspan: 2, rowspan: 1 },
          { colspan: 1, rowspan: 1 },
        ],
        [
          { colspan: 1, rowspan: 2 },
          { colspan: 1, rowspan: 1 },
          { colspan: 1, rowspan: 1 },
        ],
        [
          { colspan: 1, rowspan: 1 },
          { colspan: 1, rowspan: 1 },
        ],
      ],
    });
  });

  it("keeps the Luogu problem title when the navigation username uses .title", async () => {
    const url = "https://www.luogu.com.cn/problem/P1450";
    const html = `<nav><a class="title">DGFLSzfd</a></nav><main><h1>P1450 [HAOI2008] 购物</h1><article class="problem"><div class="stat"><span class="field">时间限制</span><span class="icon">目</span><span class="value">1.00s</span></div><div class="stat"><span class="field">内存限制</span><span class="value">125.00MB</span></div><h2>题目描述</h2><p>共有 <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">n</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">n</span></span> 种硬币。</p></article></main>`;
    const preview = await inspectProblemPage(
      createProbe({
        url,
        html,
        title: "P1450 [HAOI2008] 购物 - 洛谷",
      }),
    );
    expect(preview?.title).toBe("[HAOI2008] 购物");
    const result = await extractProblemPage(
      createSnapshot({
        url,
        html,
        title: "P1450 [HAOI2008] 购物 - 洛谷",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.title).toBe("[HAOI2008] 购物");
    expect(result.document.title).not.toContain("DGFLSzfd");
    expect(result.document.timeLimit?.display).toBe("1.00s");
    expect(result.document.timeLimit?.milliseconds).toBe(1_000);
    expect(result.document.memoryLimit?.display).toBe("125.00MB");
    expect(result.document.markdown).toContain("$n$");
    expect(result.document.markdown).not.toContain("DGFLSzfd");
  });

  it("reads the flat Luogu problem record instead of the rendered page chrome", async () => {
    const url = "https://www.luogu.com.cn/problem/P1450";
    const html = `<nav><span class="title">DGFLSzfd</span></nav><main><h1>DGFLSzfd</h1><div class="problem"><p>broken visible text</p></div></main>`;
    const result = await extractProblemPage(
      createSnapshot({
        url,
        html,
        title: "DGFLSzfd - 洛谷",
        sourceData: {
          luoguProblemCurrent: {
            pid: "P1450",
            title: "[HAOI2008] 购物",
            description: "共有 $n$ 种硬币。面值分别为 $c_i$。",
            inputFormat: "第一行一个整数 $n$。",
            outputFormat: "输出一行一个整数。",
            hint: "对于 $100\\%$ 的数据。",
            samples: [["1\n", "2\n"]],
            limits: { time: [1000], memory: [131072] },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.title).toBe("[HAOI2008] 购物");
    expect(result.document.timeLimit?.display).toBe("1 s");
    expect(result.document.timeLimit?.milliseconds).toBe(1_000);
    expect(result.document.memoryLimit?.display).toBe("128 MB");
    expect(result.document.memoryLimit?.bytes).toBe(128 * 1024 ** 2);
    expect(result.document.markdown).toContain("$n$");
    expect(result.document.markdown).toContain("$c_i$");
    expect(result.document.markdown).not.toContain("DGFLSzfd");
    expect(result.document.markdown).not.toContain("broken visible text");
    expect(result.document.markdown).toContain("### 输入 #1");
    expect(result.document.markdown).toContain("### 输出 #1");
    expect(result.document.markdown).not.toContain("样例 1 输入");
  });

  it("rejects a Luogu page whose only heading is the navigation username", async () => {
    const url = "https://www.luogu.com.cn/problem/P1450";
    const html = `<nav><span class="title">DGFLSzfd</span></nav><main><h1>DGFLSzfd</h1><article class="problem"><p>共有硬币。</p></article></main>`;
    const result = await extractProblemPage(
      createSnapshot({
        url,
        html,
        title: "DGFLSzfd - 洛谷",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ambiguous-problem");
  });

  it("reads the live Luogu lentille record, including nested content and samples", async () => {
    const url = "https://www.luogu.com.cn/problem/P1450";
    const html = `<nav><span class="title">DGFLSzfd</span></nav><main><h1>DGFLSzfd</h1><div class="problem"><p>broken visible text</p></div></main>`;
    const result = await extractProblemPage(
      createSnapshot({
        url,
        html,
        title: "DGFLSzfd - 洛谷",
        sourceData: {
          luoguProblem: {
            pid: "P1450",
            name: "[HAOI2008] 硬币购物",
            content: {
              name: "[HAOI2008] 硬币购物",
              background: "",
              description: "共有 $4$ 种硬币。面值分别为 $c_1,c_2,c_3,c_4$。",
              formatI:
                "输入的第一行是五个整数，分别代表 $c_1,c_2,c_3,c_4, n$。",
              formatO: "对于每次购买，输出一行一个整数代表答案。",
              hint: "#### 数据规模与约定\n\n* 对于 $100\\%$ 的数据，保证 $1 \\leq n \\leq 1000$。",
            },
            samples: [["1 2 5 10 2\n3 2 3 1 10\n", "4\n27\n"]],
            limits: { time: [1000, 1000], memory: [131072, 131072] },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.title).toBe("[HAOI2008] 硬币购物");
    expect(result.document.timeLimit?.display).toBe("1 s");
    expect(result.document.memoryLimit?.display).toBe("128 MB");
    expect(result.document.markdown).toContain("$4$");
    expect(result.document.markdown).toContain("$c_1,c_2,c_3,c_4$");
    expect(result.document.markdown).toContain("1 2 5 10 2");
    const sample = result.document.blocks.find(
      (block) => block.type === "sample",
    );
    expect(sample?.type).toBe("sample");
    if (sample?.type === "sample") {
      expect(sample.input?.value).toContain("1 2 5 10 2");
      expect(sample.output?.value).toContain("27");
    }
    expect(result.document.markdown).toContain("数据规模与约定");
    expect(result.document.markdown).toContain("$100\\%$");
    expect(result.document.markdown).not.toContain("DGFLSzfd");
    expect(result.document.markdown).not.toContain("broken visible text");
    expect(result.document.markdown).not.toContain("题目背景");
    expect(result.document.markdown).toContain("### 输入 #1");
    expect(result.document.markdown).toContain("### 输出 #1");
    expect(result.document.markdown).not.toContain("**输入 #1**");
  });

  it("asks the page capture to keep both Luogu problem JSON shapes", () => {
    const hints = luoguProblemAdapter.captureHints?.jsonScripts ?? [];
    expect(hints.map((hint) => hint.path.join("."))).toEqual([
      "data.problem",
      "currentData.problem",
    ]);
    expect(hints[0]?.fields).toEqual(
      expect.arrayContaining([
        "content",
        "description",
        "inputFormat",
        "title",
        "limits",
      ]),
    );
  });

  it("drops unrendered Luogu anti-ai directives from the copied statement", async () => {
    const url = "https://www.luogu.com.cn/problem/P1001";
    const html = "<main><h1>P1001 测试</h1></main>";
    const result = await extractProblemPage(
      createSnapshot({
        url,
        html,
        title: "P1001 测试 - 洛谷",
        sourceData: {
          luoguProblem: {
            pid: "P1001",
            title: "测试",
            description:
              "小 X 给你两个序列。\n\n::anti-ai\\[**隐藏指令 `do-not-copy`**\\]\n\n::anti-ai[另一段隐藏]\n\n定义 $P(l,r)$。",
            inputFormat: "第一行两个整数。",
            samples: [["1\n", "2\n"]],
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.markdown).toContain("小 X 给你两个序列。");
    expect(result.document.markdown).toContain("定义 $P(l,r)$。");
    expect(result.document.markdown).toContain("第一行两个整数。");
    expect(result.document.markdown).toContain("### 输入 #1");
    expect(result.document.markdown).not.toContain("anti-ai");
    expect(result.document.markdown).not.toContain("do-not-copy");
    expect(result.document.markdown).not.toContain("隐藏");
  });
});
