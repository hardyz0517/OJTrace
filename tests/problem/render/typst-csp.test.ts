import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { BrowserTypstCompiler } from "../../../src/problem/render/browser-typst-compiler";
import { TypstProblemRenderer } from "../../../src/problem/render/typst-renderer";

const document = {
  oj: "luogu" as const,
  problemId: "P1450",
  title: "[HAOI2008] 硬币购物",
  originalUrl: "https://www.luogu.com.cn/problem/P1450",
  timeLimit: { display: "1000 ms", milliseconds: 1000 },
  memoryLimit: { display: "131072 KiB", bytes: 128 * 1024 * 1024 },
  language: "zh" as const,
  blocks: [
    {
      type: "heading" as const,
      level: 2,
      children: [{ type: "text" as const, value: "题目描述" }],
    },
    {
      type: "paragraph" as const,
      children: [
        { type: "text" as const, value: "共有 " },
        { type: "inline-math" as const, value: String.raw`\frac{a}{b} \le c` },
        { type: "text" as const, value: " 种硬币。" },
      ],
    },
    { type: "math" as const, value: String.raw`\sum_{i=1}^{n} i` },
    {
      type: "sample" as const,
      input: { type: "code" as const, value: "1 2\n3 4" },
      output: { type: "code" as const, value: "3\n7" },
    },
  ],
  markdown: "",
  assets: [],
  warnings: [],
};

describe("browser Typst CSP compatibility", () => {
  it("compiles a formula-containing A4 PDF when dynamic Function is forbidden", async () => {
    const originalFunction = globalThis.Function;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("self", globalThis);
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("browser", {
      runtime: {
        getURL: (path: string) => `chrome-extension://ojtrace${path}`,
      },
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const resourceUrl = String(input);
      if (resourceUrl.startsWith("data:")) return originalFetch(input);
      const assetPath = new URL(resourceUrl).pathname.replace(/^\//, "");
      const bytes = await readFile(
        new URL(`../../../public/${assetPath}`, import.meta.url),
      );
      return new Response(bytes, { status: 200 });
    });
    vi.stubGlobal(
      "Function",
      new Proxy(originalFunction, {
        construct() {
          throw new EvalError(
            "Refused by extension CSP: unsafe-eval is disabled",
          );
        },
      }),
    );

    let bytes: Uint8Array;
    try {
      bytes = await new TypstProblemRenderer(new BrowserTypstCompiler()).render(
        document,
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(Array.from(bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
    expect(bytes.byteLength).toBeGreaterThan(2_000);
  }, 30_000);
});
