import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import type { ProblemDocument, ProblemPreview } from "../../src/problem/domain";
import {
  ProblemExportService,
  type ProblemAdapterRegistryLike,
} from "../../src/application/problem-export/service";
import {
  createProblemExportJob,
  readProblemExportJob,
  consumeProblemExportJob,
} from "../../src/application/problem-export/export-state";
import { problemAdapterRegistry } from "../../src/problem/registry";

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
    tabs: { get: tabsGet },
    scripting: { executeScript },
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
    },
  };
  vi.stubGlobal("browser", browser);
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

function baseDocument(assets: ProblemDocument["assets"] = []): ProblemDocument {
  return {
    oj: "codeforces",
    problemId: "1A",
    title: "A+B",
    originalUrl: url,
    blocks: [
      { type: "paragraph", children: [{ type: "text", value: "题面" }] },
    ],
    markdown: "题面",
    assets,
    warnings: [],
  };
}

function registryFor(
  document: ProblemDocument,
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
    extract: vi.fn(async (snapshot) => {
      onExtract?.(snapshot);
      return { ok: true as const, document };
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("problem export service", () => {
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
    expect(markdown).toContain("# P1001 A+B Problem\n");
    expect(markdown).toContain("- 来源：洛谷\n");
    expect(markdown).toContain(`- 原题：${pageUrl}\n`);
    expect(markdown).toContain("- 时间限制：1 s\n");
    expect(markdown).toContain("- 内存限制：512 MB\n");
    expect(markdown).toContain("$a+b$");
    expect(markdown).toContain("20 30");
    expect(markdown).not.toContain("problem-export.html");
  });

  it("reports a page with no copyable statement", async () => {
    const { executeScript } = installBrowser();
    installPage();
    serializedExecution(executeScript);
    const registry = registryFor(baseDocument());
    vi.mocked(registry.extract).mockResolvedValue({
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

  it("captures the current Luogu structured source and exports its statement", async () => {
    const { browser, executeScript } = installBrowser();
    const html = readFileSync(
      new URL(
        "../../docs/fixtures/problem/luogu-current.html",
        import.meta.url,
      ),
      "utf8",
    ).replace('"content":{"name"', '"contenu":{"name"');
    const pageUrl = "https://www.luogu.com.cn/problem/P1001";
    installPage(html, pageUrl);
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 7, url: pageUrl });
    serializedExecution(executeScript);
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
    ) as { document?: ProblemDocument } | undefined;
    expect(documentEvent?.document?.title).toBe("A+B Problem");
    expect(documentEvent?.document?.timeLimit?.milliseconds).toBe(1_000);
    expect(documentEvent?.document?.memoryLimit?.bytes).toBe(512 * 1024 ** 2);
    expect(documentEvent?.document?.markdown).toContain("$a+b$");
    expect(documentEvent?.document?.markdown).toContain("数据范围");
  });

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
      extract: vi.fn(async () => ({
        ok: true as const,
        document: baseDocument(),
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
      extract: vi.fn(async () => ({
        ok: true as const,
        document: baseDocument(),
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

    expect(registry.extract).toHaveBeenCalledOnce();
    const document = events.find(
      (event) =>
        (event as { type?: string }).type === "PROBLEM_EXPORT_DOCUMENT",
    ) as { document?: { warnings?: { code: string }[] } } | undefined;
    expect(document?.document?.warnings?.[0]?.code).toBe("image-unembedded");
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

    expect(registry.extract).toHaveBeenCalledOnce();
    const document = events.find(
      (event) =>
        (event as { type?: string }).type === "PROBLEM_EXPORT_DOCUMENT",
    ) as
      | {
          document?: {
            assets?: {
              sourceUrl: string;
              dataUrl?: string;
              mimeType?: string;
            }[];
            warnings?: { code: string }[];
          };
        }
      | undefined;
    expect(document?.document?.assets?.[0]).toMatchObject({
      sourceUrl,
      mimeType: "image/png",
    });
    expect(document?.document?.assets?.[0]?.dataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(document?.document?.warnings ?? []).not.toEqual(
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
  expect(registry.extract).toHaveBeenCalledOnce();
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "PROBLEM_EXPORT_DOCUMENT",
        document: expect.objectContaining({
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

  it("expires and consumes jobs exactly once", async () => {
    installBrowser();
    const job = await createProblemExportJob({
      tabId: 7,
      expectedUrl: url,
      now: 100,
      ttlMs: 10,
    });
    await expect(readProblemExportJob(job.token, 109)).resolves.toMatchObject({
      token: job.token,
    });
    await expect(
      consumeProblemExportJob(job.token, 109),
    ).resolves.toMatchObject({
      token: job.token,
    });
    await expect(
      consumeProblemExportJob(job.token, 109),
    ).resolves.toBeUndefined();
    await expect(readProblemExportJob(job.token, 200)).resolves.toBeUndefined();
  });
});
