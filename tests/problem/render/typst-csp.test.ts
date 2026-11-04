import { extractRenderedDocument } from "../source-test-helpers";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { BrowserTypstCompiler } from "../../../src/problem/render/browser-typst-compiler";
import { TypstProblemRenderer } from "../../../src/problem/render/typst-renderer";
import {
  parseProblemMarkdown,
  serializeProblemMarkdown,
} from "../../../src/problem/problem-markdown";
import { serializeMarkdown } from "../../../src/problem/markdown/serialize";
import type { RenderDocument } from "../../../src/problem/domain";
import { OffscreenPdfRenderer } from "../../../entrypoints/pdf-worker/renderer";
import { createSnapshot } from "../snapshot-fixtures";

const document: RenderDocument = {
  oj: "luogu" as const,
  problemId: "P1450",
  title: "[HAOI2008] 硬币购物",
  originalUrl: "https://www.luogu.com.cn/problem/P1450",
  timeLimit: { display: "1000 ms", milliseconds: 1000 },
  memoryLimit: { display: "131072 KiB", bytes: 128 * 1024 * 1024 },
  language: "zh" as const,
  ast: {
    type: "root" as const,
    children: [
      {
        type: "heading" as const,
        level: 2,
        children: [{ type: "text" as const, value: "题目描述" }],
      },
      {
        type: "paragraph" as const,
        children: [
          { type: "text" as const, value: "共有 " },
          {
            type: "inline-math" as const,
            value: String.raw`\frac{a}{b} \le c`,
          },
          { type: "text" as const, value: " 种硬币。" },
        ],
      },
      { type: "math" as const, value: String.raw`\sum_{i=1}^{n} i` },
      { type: "code", value: "1 2" },
      { type: "code", value: "3" },
    ],
  },

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
    vi.stubGlobal("browser", undefined);
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
    let svg = "";
    let atcoderPreview = "";
    let compiledDocument: RenderDocument;
    try {
      const source = serializeProblemMarkdown(
        { ...document },
        serializeMarkdown(document.ast.children),
      )
        .replace("id: P1450", "id: P6187")
        .replace('title: "[HAOI2008] 硬币购物"', 'title: "front matter title"')
        .replace("time_limit: 1000 ms", "time_limit: 2 s");
      const parsed = parseProblemMarkdown(source, document);
      if (!parsed.ok) throw new Error(parsed.message);
      compiledDocument = parsed.value;
      const renderer = new TypstProblemRenderer(
        new BrowserTypstCompiler(undefined, "chrome-extension://ojtrace/"),
      );
      const worker = new OffscreenPdfRenderer({
        pdf: (document) => renderer.render(document),
        dispose() {},
      });
      const result = await worker.render(
        "csp-pdf-worker-test",
        compiledDocument,
      );
      if (!result.ok) throw new Error(result.error);
      try {
        bytes = new Uint8Array(
          await (await originalFetch(result.url)).arrayBuffer(),
        );
        expect(result.filename).toBe("P6187-front matter title.pdf");
      } finally {
        worker.release("csp-pdf-worker-test");
      }
      svg = await renderer.preview(compiledDocument);
      // Imported Luogu banks must reach real PDF generation, not just pass
      // popup recognition. These statements were captured from public pages.
      for (const [bank, id] of [
        ["atcoder", "AT_abc175_f"],
        ["codeforces", "CF1A"],
        ["spoj", "SP1"],
        ["uva", "UVA100"],
        ["cf1209f-samples", "CF1209F"],
      ]) {
        const html = await readFile(
          new URL(
            `../../../docs/fixtures/problem/luogu-${bank === "cf1209f-samples" ? bank : `bank-${bank}`}.html`,
            import.meta.url,
          ),
          "utf8",
        );
        const context = JSON.parse(
          html.match(
            /<script[^>]*id="lentille-context"[^>]*>([\s\S]*?)<\/script>/i,
          )![1]!,
        ) as { data: { problem: Record<string, unknown> } };
        const extracted = await extractRenderedDocument(
          createSnapshot({
            url: `https://www.luogu.com.cn/problem/${id}`,
            html,
            sourceData: { luoguProblem: context.data.problem },
          }),
        );
        const pdf = await renderer.render(extracted);
        expect(Array.from(pdf.slice(0, 5)), id).toEqual([37, 80, 68, 70, 45]);
        expect(pdf.byteLength, id).toBeGreaterThan(2000);
        if (bank === "atcoder") {
          // PDF and preview use the same document/template: check real rendered
          // text as well as valid PDF bytes, so a mixed-language PDF cannot pass.
          atcoderPreview = await renderer.preview(extracted);
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
    expect(Array.from(bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
    expect(bytes.byteLength).toBeGreaterThan(2_000);
    expect(compiledDocument).toMatchObject({
      problemId: "P6187",
      title: "front matter title",
      timeLimit: { display: "2 s" },
    });
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<script");
    const window = new JSDOM().window;
    try {
      const parsed = new window.DOMParser().parseFromString(
        svg,
        "image/svg+xml",
      );
      expect(parsed.querySelector("parsererror")).toBeNull();
      expect(parsed.documentElement.localName).toBe("svg");
      expect(parsed.querySelector(".typst-page use")).not.toBeNull();
      expect(parsed.querySelector("defs path")).not.toBeNull();
      expect(parsed.querySelector("style")?.textContent).toContain(
        ".typst-text",
      );
      expect(parsed.documentElement.getAttribute("viewBox")).toMatch(/^0 0 /);
      expect(parsed.documentElement.textContent).toContain(
        "front matter title",
      );
      expect(parsed.documentElement.textContent).not.toContain("time_limit");
      const atcoder = new window.DOMParser().parseFromString(
        atcoderPreview,
        "image/svg+xml",
      );
      expect(atcoder.querySelector("parsererror")).toBeNull();
      const text = atcoder.documentElement.textContent;
      expect(text).toContain("样例解释");
      expect(text).not.toMatch(/说明\/提示|Sample Explanation|高橋君|制約/);
    } finally {
      window.close();
    }
  }, 60_000);
});
