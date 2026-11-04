import { inlineText } from "../../src/problem/markdown/text";
import { serializeMarkdown } from "../../src/problem/markdown/serialize";
import * as cnoi from "../../src/problem/cnoi/transform";
import { createSnapshot } from "../problem/snapshot-fixtures";
import { problemDocumentToTypst } from "../../src/problem/render/template";
import {
  sourceFixture,
  cnoiFixture,
  sourceNodes,
} from "../problem/source-test-helpers";
import { parseProblemMarkdown } from "../../src/problem/problem-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import type {
  CnoiProblem,
  RenderDocument,
  ProblemPreview,
} from "../../src/problem/domain";
import {
  ProblemExportService,
  type ProblemAdapterRegistryLike,
} from "../../src/application/problem-export/service";
import {
  createProblemExportJob,
  readProblemExportJob,
  deleteProblemExportJob,
} from "../../src/application/problem-export/export-state";
import { problemAdapterRegistry } from "../../src/problem/registry";
import { safeFilename } from "../../src/problem/render/pdf-file";
import { atcoderFixture } from "../problem/atcoder-fixture";

const url = "https://codeforces.com/problemset/problem/1/A";

function installBrowser() {
  let session: Record<string, unknown> = {};
  let local: Record<string, unknown> = {};
  const storageArea = (
    read: () => Record<string, unknown>,
    write: (value: Record<string, unknown>) => void,
  ) => ({
    get: vi.fn(async (key: string | null) =>
      key === null ? { ...read() } : { [key]: read()[key] },
    ),
    set: vi.fn(async (value: Record<string, unknown>) =>
      write({ ...read(), ...value }),
    ),
    remove: vi.fn(async (key: string | string[]) => {
      const next = { ...read() };
      for (const item of Array.isArray(key) ? key : [key]) delete next[item];
      write(next);
    }),
  });
  const tabsGet = vi.fn(async () => ({ id: 7, url }));
  const executeScript = vi.fn();
  const browser = {
    storage: {
      session: {
        get: vi.fn(async (key: string | null) =>
          key === null ? { ...session } : { [key]: session[key] },
        ),
        set: vi.fn(async (value: Record<string, unknown>) => {
          session = { ...session, ...value };
        }),
        remove: vi.fn(async (key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            delete session[item];
        }),
      },
      local: storageArea(
        () => local,
        (value) => {
          local = value;
        },
      ),
    },
    tabs: { get: tabsGet, create: vi.fn(async () => ({ id: 9 })) },
    scripting: { executeScript },
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
      getContexts: vi.fn(async () => []),
      sendMessage: vi.fn(
        async (message: { type: string; document?: RenderDocument }) =>
          message.type === "render"
            ? {
                ok: true,
                url: "blob:chrome-extension://test/pdf",
                filename: safeFilename(message.document!),
              }
            : { ok: true },
      ),
    },
    offscreen: {
      createDocument: vi.fn(async () => {}),
      closeDocument: vi.fn(async () => {}),
    },
    downloads: {
      download: vi.fn(async () => 1),
      search: vi.fn(async () => [{ id: 1, state: "complete" }]),
      cancel: vi.fn(async () => {}),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  vi.stubGlobal("browser", browser);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("No page request fixture");
    }),
  );
  return { browser, tabsGet, executeScript };
}

function installPage(
  html = "<main><h1>A+B</h1><p>题面</p></main>",
  pageUrl = url,
) {
  const dom = new JSDOM(
    `<!doctype html><html lang="zh"><body>${html}</body></html>`,
    {
      url: pageUrl,
    },
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("FileReader", dom.window.FileReader);
  vi.stubGlobal("Blob", dom.window.Blob);
  return dom;
}

function serializedExecution(executeScript: ReturnType<typeof vi.fn>) {
  executeScript.mockImplementation(
    async (details: { func: Function; args: unknown[] }) => {
      // Evaluate the function source in a fresh function scope to model
      // scripting.executeScript's page serialization boundary.
      const pageFunction = Function(
        `return (${details.func.toString()})`,
      )() as (...args: unknown[]) => Promise<unknown>;
      return [{ result: await pageFunction(...details.args) }];
    },
  );
}

function baseDocument(assets: RenderDocument["assets"] = []): RenderDocument {
  return {
    oj: "codeforces",
    problemId: "1A",
    title: "A+B",
    originalUrl: url,
    ast: {
      type: "root" as const,
      children: [
        { type: "paragraph", children: [{ type: "text", value: "题面" }] },
      ],
    },

    assets,
    warnings: [],
  };
}

function registryFor(
  document: RenderDocument,
  onExtract?: (snapshot: {
    imageWarnings?: readonly { code: string }[];
  }) => void,
): ProblemAdapterRegistryLike {
  const preview: ProblemPreview = {
    oj: "codeforces",
    ojDisplayName: "Codeforces",
    problemId: "1A",
    title: "A+B",
    originalUrl: url,
  };
  return {
    inspect: vi.fn(async () => preview),
    extractSource: vi.fn(async (snapshot) => {
      onExtract?.(snapshot);
      return { ok: true as const, source: sourceFixture(document) };
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("problem export service", () => {
  it("refuses a lost rules snapshot instead of silently reading newer rules", async () => {
    const { executeScript } = installBrowser();
    installPage();
    serializedExecution(executeScript);
    const service = new ProblemExportService({
      registry: registryFor(baseDocument()),
      loadRules: async () => ({
        rules: { formatVersion: 1, bySource: {} },
        problems: {},
      }),
    });
    const fallback = await createProblemExportJob({
      tabId: 7,
      expectedUrl: url,
    });
    const events: unknown[] = [];
    await service.deliver(
      { postMessage: (e) => events.push(e) },
      fallback.token,
    );
    expect(JSON.stringify(events)).toContain("规则快照已失效");
    expect(executeScript).not.toHaveBeenCalled();
  });
  it("snapshots rules when starting a task, shares direct/editor conversion and never changes Source copies", async () => {
    const { browser, executeScript } = installBrowser();
    installPage();
    serializedExecution(executeScript);
    const source = {
      metadata: {
        oj: "codeforces" as const,
        problemId: "1A",
        title: "A+B",
        originalUrl: url,
        language: "en" as const,
      },
      sourceMarkdown:
        "## Input\n\nFormat.\n\n## Examples\n\n### Input\n\n```\n1\n```\n",
      assets: [],
      warnings: [],
    };
    let level = 3;
    const loadRules = vi.fn(async () => ({
      rules: {
        formatVersion: 1 as const,
        bySource: {
          codeforces: {
            defaultsVersion: 1 as const,
            overrides: { sectionLevel: level },
          },
        },
      },
      problems: {},
    }));
    const service = new ProblemExportService({
      registry: {
        inspect: async () => undefined,
        extractSource: async () => ({ ok: true, source }),
      },
      loadRules,
    });
    const job = await service.start(7, url, "edit");
    level = 4;
    const events: unknown[] = [];
    await service.deliver(
      { postMessage: (event) => events.push(event) },
      job.token,
    );
    const payload = events.find(
      (v): v is { type: string; problem: CnoiProblem } =>
        Boolean(
          v &&
          typeof v === "object" &&
          "type" in v &&
          v.type === "PROBLEM_EXPORT_DOCUMENT",
        ),
    );
    expect(payload?.problem.cnoiMarkdown).toContain("### Sample Input");
    expect(payload?.problem.cnoiMarkdown).not.toContain("#### Sample Input");
    await service.start(7, url, "download");
    const rendered = vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.find(([message]) => message.type === "render")?.[0].document;
    expect(
      rendered?.ast.children.some((n) => n.type === "heading" && n.level === 4),
    ).toBe(true);
    expect(await service.extractMarkdown(7, url)).toBe(source.sourceMarkdown);
    expect(loadRules).toHaveBeenCalledTimes(2);
  });

  it.each(["en", "ja"] as const)(
    "copies the rendered AtCoder %s statement without either Copy control",
    async (language) => {
      const { browser, executeScript } = installBrowser();
      const pageUrl = `https://atcoder.jp/contests/abc391/tasks/abc391_g?lang=${language}`;
      installPage(
        atcoderFixture({ language, rendered: true, copyControls: true }),
        pageUrl,
      );
      vi.mocked(browser.tabs.get).mockResolvedValue({ id: 7, url: pageUrl });
      serializedExecution(executeScript);
      const source = await new ProblemExportService({
        registry: problemAdapterRegistry,
      }).extractMarkdown(7, pageUrl);
      expect(source).not.toMatch(
        /Copy|data-ojtrace|<pre|<span|duplicated visual/,
      );
      expect(source).toContain("```text+math\n$N$ $M$\n$S$\n```");
      if (language === "en")
        expect(source).toBe(
          readFileSync(
            "tests/problem/fixtures/atcoder-abc391-g.en.source.md",
            "utf8",
          ).replaceAll("\r\n", "\n"),
        );
      else {
        expect(source).toContain("### 入力例 3");
        expect(source).not.toContain("Sample Input");
      }
      expect(browser.tabs.create).not.toHaveBeenCalled();
      expect(browser.offscreen.createDocument).not.toHaveBeenCalled();
    },
  );

  it("copies the complete P5665 native export without importing DOM sample presentation", async () => {
    const { browser, executeScript } = installBrowser();
    const native = JSON.parse(
      readFileSync("tests/problem/fixtures/luogu-p5665-math.json", "utf8"),
    );
    const pageUrl = "https://www.luogu.com.cn/problem/P5665";
    const sampleUi = (native.data.problem.samples as string[][])
      .map(
        (pair, index) =>
          '<div class="io-sample">' +
          pair
            .map(
              (value, part) =>
                `<div class="io-sample-block"><p><b>${part === 0 ? "输入" : "输出"} #${index + 1}</b><button>复制</button></p><pre>${value}</pre></div>`,
            )
            .join("") +
          "</div>",
      )
      .join("");
    installPage(
      `<script id="lentille-context" type="application/json">${JSON.stringify(native)}</script>` +
        `<main><h1>P5665 [CSP-S 2019] 划分</h1><article class="problem"><h2>输入输出样例</h2>${sampleUi}</article></main>`,
      pageUrl,
    );
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 7, url: pageUrl });
    serializedExecution(executeScript);
    const service = new ProblemExportService({
      registry: problemAdapterRegistry,
    });
    const copied = await service.extractMarkdown(7, pageUrl);
    expect(copied).toBe(
      readFileSync(
        "tests/problem/fixtures/luogu-p5665.source.md",
        "utf8",
      ).replace(/\r\n/g, "\n"),
    );
    expect(browser.tabs.create).not.toHaveBeenCalled();
    expect(browser.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it("executes the probe after function serialization without module-scope constants", async () => {
    const { executeScript } = installBrowser();
    installPage();
    serializedExecution(executeScript);
    const registry = registryFor(baseDocument());
    const service = new ProblemExportService({ registry });

    await expect(service.inspect(7, url)).resolves.toMatchObject({
      problemId: "1A",
    });
    expect(executeScript).toHaveBeenCalledOnce();
    expect(executeScript.mock.calls[0]?.[0].func.toString()).not.toContain(
      "SUPPORTED_IMAGE_TYPES",
    );
  });

  it("extracts problem markdown from the statement snapshot without opening an export page", async () => {
    const { browser, executeScript } = installBrowser();
    const html = readFileSync(
      new URL(
        "../../docs/fixtures/problem/luogu-current.html",
        import.meta.url,
      ),
      "utf8",
    );
    const pageUrl = "https://www.luogu.com.cn/problem/P1001";
    installPage(html, pageUrl);
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 7, url: pageUrl });
    serializedExecution(executeScript);

    const markdown = await new ProblemExportService({
      registry: problemAdapterRegistry,
    }).extractMarkdown(7, pageUrl);

    expect(executeScript.mock.calls[0]?.[0].args[0]).toMatchObject({
      mode: "snapshot",
    });
    expect(markdown).not.toContain("- 来源：");
    expect(markdown).not.toContain("- 时间限制：");
    expect(markdown).toContain("$a+b$");
    expect(markdown).toContain("## 题目描述");
    expect(markdown).not.toMatch(/<section|<span|<pre|data-ojtrace/);
    expect(markdown).toContain("20 30");
    expect(markdown).not.toContain("problem-export.html");
  });

  it("reports a page with no copyable statement", async () => {
    const { executeScript } = installBrowser();
    installPage();
    serializedExecution(executeScript);
    const registry = registryFor(baseDocument());
    vi.mocked(registry.extractSource).mockResolvedValue({
      ok: false,
      reason: "statement-not-found",
    });

    await expect(
      new ProblemExportService({ registry }).extractMarkdown(7, url),
    ).rejects.toMatchObject({
      code: "extract_failed",
      message: "当前页面没有可复制的题面。",
    });
  });

  describe("Luogu math sources after SPA navigation", () => {
    const mathUrl = "https://www.luogu.com.cn/problem/P5665";
    const native = JSON.parse(
      readFileSync(
        new URL("../problem/fixtures/luogu-p5665-math.json", import.meta.url),
        "utf8",
      ),
    );
    const renderedOnly =
      '<main><h1>P5665 [CSP-S 2019] 划分</h1><article class="problem"><h2>题目描述</h2><p>注意 <span class="katex"><span class="katex-html" aria-hidden="true">k0=0</span></span></p><span class="katex-display"><span class="katex"><span class="katex-html" aria-hidden="true">i=1Σk1ai≤i=k1+1Σk2ai</span></span></span></article></main>';
    const expectTex = (markdown: string) => {
      expect(markdown).toContain(String.raw`\sum_{i=1}^{k_1} a_i`);
      expect(markdown).toContain(
        String.raw`\left(\sum_{i=k_p+1}^{n} a_i\right)^2`,
      );
      expect(markdown).toContain("$a_i$");
      expect(markdown).toContain("$k_0 = 0$");
      expect(markdown).not.toContain("Σ");
    };
    const setup = (context?: unknown) => {
      const { browser, executeScript } = installBrowser();
      installPage(
        `${context ? `<script id="lentille-context" type="application/json">${JSON.stringify(context)}</script>` : ""}${renderedOnly}`,
        mathUrl,
      );
      vi.mocked(browser.tabs.get).mockResolvedValue({ id: 7, url: mathUrl });
      serializedExecution(executeScript);
      return new ProblemExportService({ registry: problemAdapterRegistry });
    };

    it("keeps complex native TeX on an initial load without fetching again", async () => {
      const service = setup(native);
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expectTex(await service.extractMarkdown(7, mathUrl));
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      undefined,
      { data: { problem: { pid: "P1001", description: "Previous problem." } } },
    ])(
      "reads the current native response when initial JSON is missing or stale: %j",
      async (context) => {
        const service = setup(context);
        const fetch = vi.fn(async () => Response.json(native));
        vi.stubGlobal("fetch", fetch);
        const source = await service.extractMarkdown(7, mathUrl);
        expectTex(source);
        expect(source).not.toContain("Previous problem.");
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(
          mathUrl,
          expect.objectContaining({
            headers: { "x-lentille-request": "content-only" },
            credentials: "same-origin",
            mode: "same-origin",
            redirect: "error",
            signal: expect.any(AbortSignal),
          }),
        );
      },
    );

    it.each([
      [
        "another problem",
        () =>
          Response.json({
            data: { problem: { pid: "P1001", description: "$wrong$" } },
          }),
      ],
      ["login HTML", () => new Response("<html>login</html>")],
      ["denied request", () => new Response("denied", { status: 403 })],
    ])(
      "does not fabricate TeX from glyphs after %s",
      async (_name, response) => {
        const service = setup();
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => response()),
        );
        await expect(service.extractMarkdown(7, mathUrl)).rejects.toMatchObject(
          {
            code: "extract_failed",
            message: expect.stringContaining("LaTeX 源码"),
          },
        );
      },
    );

    it("bounds native response bytes before decoding JSON", async () => {
      const service = setup();
      const cancel = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array(3_000_001));
                },
                cancel,
              }),
            ),
        ),
      );
      await expect(service.extractMarkdown(7, mathUrl)).rejects.toMatchObject({
        code: "document_too_large",
      });
      expect(cancel).toHaveBeenCalledOnce();
    });

    it("aborts a stalled native request and reports missing source", async () => {
      const service = setup();
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              signal = init.signal;
              signal?.addEventListener("abort", () =>
                reject(new Error("aborted")),
              );
            }),
        ),
      );
      const failure = expect(
        service.extractMarkdown(7, mathUrl),
      ).rejects.toMatchObject({
        code: "extract_failed",
        message: expect.stringContaining("LaTeX 源码"),
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await failure;
      expect(signal?.aborted).toBe(true);
    });
  });

  it.each([
    [
      "luogu-current.html",
      "P1001",
      "A+B Problem",
      "$a+b$",
      1_000,
      512 * 1024 ** 2,
    ],
    [
      "luogu-bank-atcoder.html",
      "AT_abc175_f",
      "[ABC175F] Making Palindrome",
      "有 $N$ 个仅含小写字母的字符串",
      2_000,
      1024 ** 3,
    ],
    [
      "luogu-bank-codeforces.html",
      "CF1A",
      "Theatre Square",
      "剧院广场呈矩形",
      1_000,
      256_000 * 1024,
    ],
    [
      "luogu-bank-spoj.html",
      "SP1",
      "TEST - Life, the Universe, and Everything",
      "find the Answer to Life",
      10_000,
      1_536_000 * 1024,
    ],
    [
      "luogu-bank-uva.html",
      "UVA100",
      "The 3n + 1 problem",
      "考虑下面的程序",
      3_000,
      undefined,
    ],
    [
      "luogu-cf1209f-samples.html",
      "CF1209F",
      "Koala and Notebook",
      "考拉之国有 $m$ 条双向道路连接着 $n$ 座城市",
      2_000,
      512_000 * 1024,
    ],
  ] as const)(
    "captures %s through the serialized page probe and document handoff",
    async (file, id, title, content, time, memory) => {
      const { browser, executeScript } = installBrowser();
      const rawHtml = readFileSync(
        new URL(`../../docs/fixtures/problem/${file}`, import.meta.url),
        "utf8",
      );
      const html =
        file === "luogu-current.html"
          ? rawHtml.replace('"content":{"name"', '"contenu":{"name"')
          : rawHtml;
      const pageUrl = `https://www.luogu.com.cn/problem/${id}`;
      installPage(html, pageUrl);
      vi.mocked(browser.tabs.get).mockResolvedValue({ id: 7, url: pageUrl });
      serializedExecution(executeScript);
      const service = new ProblemExportService({
        registry: problemAdapterRegistry,
      });
      await expect(service.inspect(7, pageUrl)).resolves.toMatchObject({
        problemId: id,
        title,
        oj: "luogu",
      });
      const job = await createProblemExportJob({
        tabId: 7,
        expectedUrl: pageUrl,
      });
      const events: unknown[] = [];

      await new ProblemExportService({
        registry: problemAdapterRegistry,
      }).deliver(
        { postMessage: (message) => events.push(message) },
        job.token,
        job,
      );

      const documentEvent = events.find(
        (event) =>
          (event as { type?: string }).type === "PROBLEM_EXPORT_DOCUMENT",
      ) as { problem?: CnoiProblem } | undefined;
      const parsed =
        documentEvent?.problem &&
        parseProblemMarkdown(
          documentEvent.problem.cnoiMarkdown,
          documentEvent.problem,
        );
      const preparedDocument = parsed && parsed.ok ? parsed.value : undefined;
      expect(preparedDocument?.problemId).toBe(id);
      expect(preparedDocument?.title).toBe(title);
      expect(preparedDocument?.timeLimit?.milliseconds).toBe(time);
      expect(preparedDocument?.memoryLimit?.bytes).toBe(memory);
      expect(
        preparedDocument && serializeMarkdown(preparedDocument.ast.children),
      ).toContain(content);
      if (id === "CF1209F") {
        const copied = await service.extractMarkdown(7, pageUrl);
        expect(copied.match(/^## 输入输出样例 #\d+$/gm)).toEqual(
          [1, 2, 3].map((id) => `## 输入输出样例 #${id}`),
        );
        expect(
          sourceNodes({
            sourceMarkdown: copied,
            metadata: {
              oj: "luogu",
              problemId: id,
              title,
              originalUrl: pageUrl,
            },
            assets: [],
            warnings: [],
          }).filter(
            (node) =>
              node.type === "heading" &&
              /^(?:输入|输出) #\d+$/.test(inlineText(node.children)),
          ),
        ).toHaveLength(6);
        expect(copied).not.toMatch(/^## 输入输出样例$|^### \*\*/m);
        expect(
          preparedDocument?.ast.children.filter(
            (block) => block.type === "code",
          ),
        ).toHaveLength(6);
      }
      if (id === "AT_abc175_f") {
        const markdown =
          preparedDocument && serializeMarkdown(preparedDocument.ast.children);
        expect(markdown).toContain("样例解释");
        expect(markdown).not.toMatch(
          /说明\/提示|Sample Explanation|高橋君|制約/,
        );
        const copied = await service.extractMarkdown(7, pageUrl);
        expect(copied).toContain("### 样例解释");
        expect(copied).not.toMatch(/说明\/提示|Sample Explanation|高橋君|制約/);
      }
    },
  );

  it("keeps hidden TeX sources while compacting a large probe", async () => {
    const { executeScript } = installBrowser();
    installPage(
      `<main><h1>A+B</h1><span class="katex" aria-hidden="true"><math><annotation>n^2</annotation></math></span><script type="math/tex">n^2</script><p>${"长文本 ".repeat(150_000)}</p></main>`,
    );
    serializedExecution(executeScript);
    let capturedProbe = "";
    const preview: ProblemPreview = {
      oj: "codeforces",
      ojDisplayName: "Codeforces",
      problemId: "1A",
      title: "A+B",
      originalUrl: url,
    };
    const registry: ProblemAdapterRegistryLike = {
      inspect: vi.fn(async (probe) => {
        capturedProbe = probe.htmlFragment;
        return preview;
      }),
      extractSource: vi.fn(async () => ({
        ok: true as const,
        source: sourceFixture(baseDocument()),
      })),
    };
    await expect(
      new ProblemExportService({ registry }).inspect(7, url),
    ).resolves.toEqual(preview);
    expect(capturedProbe).toContain('type="math/tex"');
    expect(capturedProbe).toContain("n^2");
    expect(capturedProbe.length).toBeLessThan(512_000);
  });

  it("drops a hidden language container even when it contains math", async () => {
    const { executeScript } = installBrowser();
    installPage(
      `<span class="lang-ja" style="display: none"><p>日本語 <span class="katex"><math><annotation encoding="application/x-tex">A_{1,1}</annotation></math></span></p></span><span class="lang-en" style="display: inline"><p>English</p></span><span class="katex" aria-hidden="true"><math><annotation encoding="application/x-tex">n^2</annotation></math></span><script type="math/tex">n^2</script>`,
    );
    serializedExecution(executeScript);
    let captured = "";
    const preview: ProblemPreview = {
      oj: "codeforces",
      ojDisplayName: "Codeforces",
      problemId: "1A",
      title: "A+B",
      originalUrl: url,
    };
    const registry: ProblemAdapterRegistryLike = {
      inspect: vi.fn(async (probe) => {
        captured = probe.htmlFragment;
        return preview;
      }),
      extractSource: vi.fn(async () => ({
        ok: true as const,
        source: sourceFixture(baseDocument()),
      })),
    };
    await expect(
      new ProblemExportService({ registry }).inspect(7, url),
    ).resolves.toEqual(preview);
    expect(captured).toContain("English");
    expect(captured).not.toContain("日本語");
    expect(captured).not.toContain("A_{1,1}");
    expect(captured).toContain("n^2");
    expect(captured).toContain('type="math/tex"');
  });

  it.each(["edge://extensions/", "chrome://extensions/", "about:blank"])(
    "treats %s as unsupported without injecting a script",
    async (pageUrl) => {
      const { tabsGet, executeScript } = installBrowser();
      tabsGet.mockResolvedValue({ id: 7, url: pageUrl });
      const registry = registryFor(baseDocument());
      const service = new ProblemExportService({ registry });

      await expect(service.inspect(7, pageUrl)).resolves.toBeNull();
      expect(executeScript).not.toHaveBeenCalled();
      expect(registry.inspect).not.toHaveBeenCalled();
    },
  );

  it("rejects a navigation race after page capture", async () => {
    const { tabsGet, executeScript } = installBrowser();
    installPage();
    executeScript.mockResolvedValue([
      {
        result: {
          url,
          title: "A+B",
          baseUrl: url,
          html: "<body><main>题面</main></body>",
          htmlFragment: "<body><main>题面</main></body>",
          truncated: false,
        },
      },
    ]);
    tabsGet
      .mockResolvedValueOnce({ id: 7, url })
      .mockResolvedValueOnce({ id: 7, url })
      .mockResolvedValueOnce({ id: 7, url: "https://codeforces.com/" });
    const service = new ProblemExportService({
      registry: registryFor(baseDocument()),
    });

    await expect(service.inspect(7, url)).rejects.toMatchObject({
      code: "tab_changed",
    });
  });

  it("cancels an in-flight port task and does not deliver a document", async () => {
    const { executeScript } = installBrowser();
    installPage();
    let resolveCapture!: (value: unknown) => void;
    executeScript.mockReturnValue(
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
    );
    const service = new ProblemExportService({
      registry: registryFor(baseDocument()),
    });
    const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
    const events: unknown[] = [];
    const delivery = service.deliver(
      { postMessage: (message) => events.push(message) },
      job.token,
    );
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalled());
    await service.cancel(job.token);
    await delivery;
    expect(
      events.some(
        (event) =>
          (event as { type?: string }).type === "PROBLEM_EXPORT_DOCUMENT",
      ),
    ).toBe(false);
    await expect(readProblemExportJob(job.token)).resolves.toMatchObject({
      token: job.token,
    });
    resolveCapture([]);
  });

  it("rejects a second connection for the same active job", async () => {
    const { executeScript } = installBrowser();
    installPage();
    executeScript.mockReturnValue(new Promise(() => {}));
    const service = new ProblemExportService({
      registry: registryFor(baseDocument()),
      captureTimeoutMs: 100,
    });
    const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
    const firstEvents: unknown[] = [];
    const first = service.deliver(
      { postMessage: (message) => firstEvents.push(message) },
      job.token,
    );
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalled());
    const secondEvents: unknown[] = [];
    await service.deliver(
      { postMessage: (message) => secondEvents.push(message) },
      job.token,
    );
    expect(secondEvents).toEqual([
      expect.objectContaining({
        type: "PROBLEM_EXPORT_ERROR",
        code: "job_in_progress",
      }),
    ]);
    await first;
    expect(firstEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "PROBLEM_EXPORT_ERROR" }),
      ]),
    );
  });

  it("enforces a service-side capture timeout", async () => {
    const { executeScript } = installBrowser();
    installPage();
    executeScript.mockReturnValue(new Promise(() => {}));
    const service = new ProblemExportService({
      registry: registryFor(baseDocument()),
      captureTimeoutMs: 10,
    });
    const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
    const events: unknown[] = [];
    await service.deliver(
      { postMessage: (message) => events.push(message) },
      job.token,
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "PROBLEM_EXPORT_ERROR",
          code: "capture_failed",
        }),
      ]),
    );
  });

  it("keeps oversized streamed images out of the document", async () => {
    const sourceUrl = "https://cdn.example.test/diagram.png";
    const asset = { sourceUrl, alt: "图示", mimeType: "image/png" };
    const { executeScript } = installBrowser();
    installPage(
      `<main><h1>A+B</h1><img src="${sourceUrl}" alt="图示" /></main>`,
    );
    serializedExecution(executeScript);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(512 * 1024 + 1), {
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    const registry = registryFor(baseDocument([asset]));
    const service = new ProblemExportService({ registry });
    const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
    const events: unknown[] = [];
    await service.deliver(
      { postMessage: (message) => events.push(message) },
      job.token,
    );

    expect(registry.extractSource).toHaveBeenCalledOnce();
    const document = events.find(
      (event) =>
        (event as { type?: string }).type === "PROBLEM_EXPORT_DOCUMENT",
    ) as { problem?: { warnings?: { code: string }[] } } | undefined;
    expect(document?.problem?.warnings?.[0]?.code).toBe("image-unembedded");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "PROBLEM_EXPORT_DOCUMENT" }),
      ]),
    );
  });

  it("keeps the image timeout active while a streamed response body is pending", async () => {
    vi.useFakeTimers();
    const sourceUrl = "https://cdn.example.test/diagram.png";
    const { executeScript } = installBrowser();
    const dom = installPage(
      `<main><h1>A+B</h1><img src="${sourceUrl}" alt="图示" /></main>`,
    );
    dom.window.setTimeout = setTimeout as typeof dom.window.setTimeout;
    dom.window.clearTimeout = clearTimeout as typeof dom.window.clearTimeout;
    serializedExecution(executeScript);
    let fetchSignal: AbortSignal | undefined;
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        fetchCalls += 1;
        if (fetchCalls > 1)
          return new Response(null, { status: 404, statusText: "missing" });
        fetchSignal = init.signal as AbortSignal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            fetchSignal?.addEventListener("abort", () => {
              controller.error(new Error("request aborted"));
            });
          },
        });
        return new Response(body, { headers: { "content-type": "image/png" } });
      }),
    );
    const registry = registryFor(baseDocument([{ sourceUrl, alt: "图示" }]));
    const service = new ProblemExportService({ registry });
    const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
    const events: unknown[] = [];
    const delivery = service.deliver(
      { postMessage: (message) => events.push(message) },
      job.token,
    );
    for (let turn = 0; turn < 30 && !fetchSignal; turn += 1)
      await Promise.resolve();
    expect(fetchSignal).toBeDefined();
    await vi.advanceTimersByTimeAsync(5_000);
    await delivery;

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "PROBLEM_EXPORT_DOCUMENT" }),
      ]),
    );
    expect(fetchSignal?.aborted).toBe(true);
  });

  it("embeds a cross-origin statement image from the extension fetch", async () => {
    const sourceUrl = "https://espresso.codeforces.com/diagram.png";
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    const { executeScript } = installBrowser();
    installPage(
      `<main><h1>A+B</h1><img src="${sourceUrl}" alt="项链" /></main>`,
    );
    serializedExecution(executeScript);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const registry = registryFor(baseDocument([{ sourceUrl, alt: "项链" }]));
    const service = new ProblemExportService({
      registry,
      loadImage: async () =>
        new Response(png, {
          headers: { "content-type": "application/octet-stream" },
        }),
    });
    const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
    const events: unknown[] = [];
    await service.deliver(
      { postMessage: (message) => events.push(message) },
      job.token,
    );

    expect(registry.extractSource).toHaveBeenCalledOnce();
    const document = events.find(
      (event) =>
        (event as { type?: string }).type === "PROBLEM_EXPORT_DOCUMENT",
    ) as
      | {
          problem?: {
            assets?: {
              sourceUrl: string;
              dataUrl?: string;
              mimeType?: string;
            }[];
            warnings?: { code: string }[];
          };
        }
      | undefined;
    expect(document?.problem?.assets?.[0]).toMatchObject({
      sourceUrl,
      mimeType: "image/png",
    });
    expect(document?.problem?.assets?.[0]?.dataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(document?.problem?.warnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "image-unembedded" }),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "PROBLEM_EXPORT_DOCUMENT" }),
      ]),
    );
  });
});

it("delivers the statement when image capture exceeds its own timeout", async () => {
  const sourceUrl = "https://cdn.example.test/diagram.png";
  const { executeScript } = installBrowser();
  installPage();
  executeScript.mockImplementation(
    async (details: { func: { toString(): string }; args: unknown[] }) => {
      if (details.func.toString().includes("singleByteLimit"))
        return new Promise(() => {});
      const pageFunction = Function(
        `return (${details.func.toString()})`,
      )() as (...args: unknown[]) => Promise<unknown>;
      return [{ result: await pageFunction(...details.args) }];
    },
  );
  const registry = registryFor(baseDocument([{ sourceUrl, alt: "图" }]));
  const service = new ProblemExportService({
    registry,
    captureTimeoutMs: 20,
  });
  const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
  const events: unknown[] = [];
  await service.deliver(
    { postMessage: (message) => events.push(message) },
    job.token,
  );
  expect(registry.extractSource).toHaveBeenCalledOnce();
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "PROBLEM_EXPORT_DOCUMENT",
        problem: expect.objectContaining({
          warnings: [expect.objectContaining({ code: "image-unembedded" })],
        }),
      }),
    ]),
  );
  expect(
    events.some(
      (event) => (event as { type?: string }).type === "PROBLEM_EXPORT_ERROR",
    ),
  ).toBe(false);
});

it("does not deliver when export is cancelled during image capture", async () => {
  const sourceUrl = "https://cdn.example.test/diagram.png";
  const { executeScript } = installBrowser();
  installPage();
  let resolveImages: ((value: unknown) => void) | undefined;
  executeScript.mockImplementation(
    async (details: { func: { toString(): string }; args: unknown[] }) => {
      if (details.func.toString().includes("singleByteLimit"))
        return new Promise((resolve) => {
          resolveImages = resolve;
        });
      const pageFunction = Function(
        `return (${details.func.toString()})`,
      )() as (...args: unknown[]) => Promise<unknown>;
      return [{ result: await pageFunction(...details.args) }];
    },
  );
  const service = new ProblemExportService({
    registry: registryFor(baseDocument([{ sourceUrl, alt: "图" }])),
  });
  const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
  const events: unknown[] = [];
  const delivery = service.deliver(
    { postMessage: (message) => events.push(message) },
    job.token,
  );
  await vi.waitFor(() => expect(resolveImages).toBeTypeOf("function"));
  await service.cancel(job.token);
  await delivery;
  expect(
    events.some(
      (event) =>
        (event as { type?: string }).type === "PROBLEM_EXPORT_DOCUMENT",
    ),
  ).toBe(false);
  resolveImages?.([]);
});

it("downloads without a tab and opens a page only for editing without storing the statement", async () => {
  const { browser, executeScript } = installBrowser();
  installPage();
  serializedExecution(executeScript);
  const document = baseDocument();
  const registry = registryFor(document);
  const service = new ProblemExportService({ registry });

  const downloadJob = await service.start(7, url);
  expect(browser.tabs.create).not.toHaveBeenCalled();
  expect(browser.offscreen.createDocument).toHaveBeenCalledTimes(1);
  expect(browser.downloads.download).toHaveBeenCalledWith(
    expect.objectContaining({ filename: "1A-A+B.pdf" }),
  );
  expect(browser.offscreen.closeDocument).toHaveBeenCalledTimes(1);
  await expect(
    readProblemExportJob(downloadJob.token),
  ).resolves.toBeUndefined();
  const editJob = await service.start(7, url, "edit");
  const opened = (
    vi.mocked(browser.tabs.create).mock.calls as unknown as Array<
      [{ url?: string } | undefined]
    >
  ).map((call) => call[0]?.url ?? "");
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain("problem-export.html");
  expect(opened[0]).toContain(`token=${editJob.token}`);

  for (const area of [browser.storage.session, browser.storage.local]) {
    const stored = await area.get(null);
    expect(Object.keys(stored)).toHaveLength(1);
    for (const value of Object.values(stored)) {
      expect(Object.keys(value as object).sort()).toEqual([
        "createdAt",
        "expectedUrl",
        "expiresAt",
        "tabId",
        "token",
      ]);
    }
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("intent");
    expect(serialized).not.toContain("markdown");
    expect(serialized).not.toContain("%PDF");
  }

  const editEvents: unknown[] = [];
  await service.deliver(
    { postMessage: (message) => editEvents.push(message) },
    editJob.token,
  );
  const documentOf = (events: unknown[]) =>
    events.find(
      (event) =>
        (event as { type?: string }).type === "PROBLEM_EXPORT_DOCUMENT",
    ) as { problem?: CnoiProblem } | undefined;
  expect(registry.extractSource).toHaveBeenCalledTimes(2);
  const prepared = documentOf(editEvents)?.problem;
  expect(prepared).toEqual(cnoiFixture(document));
  if (!prepared) throw new Error("Missing prepared document");
  const parsed = parseProblemMarkdown(prepared.cnoiMarkdown, prepared);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "render", document: parsed.value }),
  );
  expect(await service.extractMarkdown(7, url)).toBe(
    serializeMarkdown(document.ast.children),
  );
});

it("surfaces offscreen startup failure without opening a tab or leaving a job behind", async () => {
  const { browser } = installBrowser();
  browser.offscreen.createDocument.mockRejectedValueOnce(
    new Error("offscreen unavailable"),
  );
  const service = new ProblemExportService({
    registry: registryFor(baseDocument()),
  });
  await expect(service.start(7, url)).rejects.toMatchObject({
    code: "download_failed",
    message: "offscreen unavailable",
  });
  expect(browser.tabs.create).not.toHaveBeenCalled();
  expect(browser.downloads.download).not.toHaveBeenCalled();
  await expect(browser.storage.session.get(null)).resolves.toEqual({});
  await expect(browser.storage.local.get(null)).resolves.toEqual({});
});

describe("problem export jobs", () => {
  it("recovers a hand-off job from the local compatibility copy", async () => {
    const { browser } = installBrowser();
    const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
    const sessionValues = await browser.storage.session.get(null);
    await browser.storage.session.remove(Object.keys(sessionValues));

    await expect(readProblemExportJob(job.token)).resolves.toMatchObject({
      token: job.token,
    });
  });

  it("uses page hand-off metadata when storage is temporarily unavailable", async () => {
    const { browser, executeScript } = installBrowser();
    installPage();
    serializedExecution(executeScript);
    const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
    const sessionValues = await browser.storage.session.get(null);
    const localValues = await browser.storage.local.get(null);
    await browser.storage.session.remove(Object.keys(sessionValues));
    await browser.storage.local.remove(Object.keys(localValues));

    const events: unknown[] = [];
    await new ProblemExportService({
      registry: registryFor(baseDocument()),
    }).deliver(
      { postMessage: (message) => events.push(message) },
      job.token,
      job,
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "PROBLEM_EXPORT_DOCUMENT" }),
      ]),
    );
  });

  it("cleans expired jobs while creating a new short-lived job", async () => {
    const { browser } = installBrowser();
    await browser.storage.session.set({
      "ojtrace:problem-export:stale": {
        token: "stale-token-long-enough",
        tabId: 7,
        expectedUrl: url,
        createdAt: 1,
        expiresAt: 2,
      },
    });
    await createProblemExportJob({ tabId: 7, expectedUrl: url, now: 100 });
    await expect(
      browser.storage.session.get("ojtrace:problem-export:stale"),
    ).resolves.toEqual({ "ojtrace:problem-export:stale": undefined });
  });

  it("keeps jobs retryable until explicit cleanup and removes expired jobs", async () => {
    const { browser } = installBrowser();
    const job = await createProblemExportJob({
      tabId: 7,
      expectedUrl: url,
      now: 100,
      ttlMs: 10,
    });
    for (let retry = 0; retry < 2; retry++)
      await expect(readProblemExportJob(job.token, 109)).resolves.toMatchObject(
        { token: job.token },
      );
    await deleteProblemExportJob(job.token);
    await expect(readProblemExportJob(job.token, 109)).resolves.toBeUndefined();
    const expired = await createProblemExportJob({
      tabId: 7,
      expectedUrl: url,
      now: 100,
      ttlMs: 10,
    });
    await expect(
      readProblemExportJob(expired.token, 110),
    ).resolves.toBeUndefined();
    await expect(browser.storage.session.get(null)).resolves.toEqual({});
    await expect(browser.storage.local.get(null)).resolves.toEqual({});
  });
});

describe("unified Source/CNOI/export behavior", () => {
  const fixture = (name: string): string =>
    readFileSync(
      new URL("../../docs/fixtures/problem/" + name, import.meta.url),
      "utf8",
    );
  it.each([
    ["https://www.luogu.com.cn/problem/P1001", fixture("luogu-current.html")],
    [
      "https://atcoder.jp/contests/abc300/tasks/abc300_a?lang=en",
      fixture("atcoder-multilang.html"),
    ],
    ["https://qoj.ac/problem/1", fixture("qoj-uoj.html")],
    ["https://qoj.ac/problem/1907", fixture("qoj-1907.html")],
    [
      "https://codeforces.com/problemset/problem/1/A",
      '<div class="problem-statement"><div class="header"><div class="title">A. English</div></div><p>English statement.</p><div class="input"><div class="title">Input</div><pre>1</pre></div><div class="output"><div class="title">Output</div><pre>2</pre></div></div>',
    ],
    [
      "https://hydro.ac/p/P1?lang=en",
      '<h1>English</h1><div data-fragment-id="problem-description"><p>An English statement with enough body text to identify a real problem.</p><h3>Sample Input 7</h3><pre>1</pre><h3>Sample Output 7</h3><pre>2</pre></div>',
    ],
    ["http://47.113.203.55/p/100", fixture("hydroj-tree.html")],
  ] as const)(
    "copies Source and delivers the same parsed content by both export paths: %s",
    async (pageUrl, html) => {
      const { browser, executeScript } = installBrowser();
      installPage(html, pageUrl);
      browser.tabs.get.mockResolvedValue({ id: 7, url: pageUrl });
      serializedExecution(executeScript);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("offline fixture");
        }),
      );
      const extracted: import("../../src/problem/domain").SourceProblem[] = [];
      const registry: ProblemAdapterRegistryLike = {
        ...problemAdapterRegistry,
        inspect: (probe) => problemAdapterRegistry.inspect(probe),
        captureHints: (url) => problemAdapterRegistry.captureHints(url),
        extractSource: vi.fn(async (snapshot) => {
          const result = await problemAdapterRegistry.extractSource(snapshot);
          if (result.ok) extracted.push(result.source);
          return result;
        }),
      };
      const spy = vi.spyOn(cnoi, "transformToCnoi");
      try {
        const service = new ProblemExportService({ registry });
        const copied = await service.extractMarkdown(7, pageUrl);
        expect(copied).toBe(extracted[0]?.sourceMarkdown);
        if (pageUrl === "https://qoj.ac/problem/1907")
          expect(copied).toBe(
            readFileSync(
              "tests/problem/fixtures/qoj-1907.source.md",
              "utf8",
            ).replaceAll("\r\n", "\n"),
          );
        if (pageUrl === "http://47.113.203.55/p/100")
          expect(copied).toBe(
            readFileSync(
              "tests/problem/fixtures/hydroj-tree.source.md",
              "utf8",
            ).replaceAll("\r\n", "\n"),
          );
        expect(spy).not.toHaveBeenCalled();
        await service.start(7, pageUrl, "download");
        expect(spy).toHaveBeenCalledTimes(1);
        const events: unknown[] = [];
        const job = await service.start(7, pageUrl, "edit");
        await service.deliver(
          { postMessage: (message) => events.push(message) },
          job.token,
        );
        expect(spy).toHaveBeenCalledTimes(2);
        expect(registry.extractSource).toHaveBeenCalledTimes(3);
        const event = events.find(
          (event) =>
            (event as { type?: string }).type === "PROBLEM_EXPORT_DOCUMENT",
        ) as { problem: CnoiProblem };
        const parsed = parseProblemMarkdown(
          event.problem.cnoiMarkdown,
          event.problem,
        );
        if (!parsed.ok) throw new Error(parsed.message);
        const rendered = browser.runtime.sendMessage.mock.calls.find(
          ([message]) => message.type === "render",
        )?.[0].document;
        expect(parsed.value).toEqual(rendered);
        expect(problemDocumentToTypst(parsed.value)).toBe(
          problemDocumentToTypst(rendered!),
        );
        expect(parsed.value.assets).toEqual(rendered?.assets);
        expect(
          extracted.every((source) => source.sourceMarkdown === copied),
        ).toBe(true);
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
      }
    },
  );
  it("keeps native Source copyable while refusing incomplete structural conversion", async () => {
    const snapshot = createSnapshot({
      url: "https://www.luogu.com.cn/problem/P1",
      html: "<main></main>",
      sourceData: {
        luoguProblem: {
          pid: "P1",
          name: "Broken",
          content: {
            description:
              '<table><tr><td rowspan="999999">source</td></tr></table>',
            locale: "en",
          },
        },
      },
    });
    const result = await problemAdapterRegistry.extractSource(snapshot);
    if (!result.ok) throw new Error(result.reason);
    expect(result.source).not.toHaveProperty("structure");
    expect(result.source.warnings).toContainEqual(
      expect.objectContaining({ code: "source-syntax-incomplete" }),
    );
    expect(result.source.sourceMarkdown).toContain('rowspan="999999"');
    const { executeScript } = installBrowser();
    installPage();
    serializedExecution(executeScript);
    const service = new ProblemExportService({
      registry: {
        inspect: async () => undefined,
        extractSource: async () => result,
      },
    });
    expect(await service.extractMarkdown(7, url)).toBe(
      result.source.sourceMarkdown,
    );
    const job = await createProblemExportJob({ tabId: 7, expectedUrl: url });
    const events: unknown[] = [];
    await service.deliver(
      { postMessage: (message) => events.push(message) },
      job.token,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "PROBLEM_EXPORT_ERROR",
        code: "extract_failed",
      }),
    );
  });
});
