import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hydrojProblemAdapter } from "../../src/problem/adapters/hydroj";
import { parseMarkdown } from "../../src/problem/markdown/parse";
import { serializeMarkdown } from "../../src/problem/markdown/serialize";
import { convertSourceToCnoi } from "../../src/problem/cnoi/convert";
import { parseProblemMarkdown } from "../../src/problem/problem-markdown";
import { createSnapshot } from "./snapshot-fixtures";

const fixture = readFileSync("docs/fixtures/problem/hydroj-tree.html", "utf8");
const treeUrl = "http://47.113.203.55/p/100";

describe("Hydro Source Markdown fidelity", () => {
  it("copies the complete tree statement as nested Markdown, merged pipe tables and plain samples", async () => {
    const result = await hydrojProblemAdapter.extractSource(
      createSnapshot({ url: treeUrl, html: fixture }),
    );
    if (!result.ok) throw new Error(result.message ?? result.reason);
    const source = result.source;
    expect(source.sourceMarkdown).toBe(
      readFileSync(
        "tests/problem/fixtures/hydroj-tree.source.md",
        "utf8",
      ).replaceAll("\r\n", "\n"),
    );
    expect(source.sourceMarkdown).not.toMatch(
      /data-ojtrace|<ul|<li|<p|<span|<table|Copy|Fill to Pretest|visual tuple|visual k/,
    );
    const ast = parseMarkdown(source.sourceMarkdown).ast;
    const list = ast.children.find((node) => node.type === "list");
    expect(list?.items).toHaveLength(3);
    expect(list?.items[1]?.children.map((node) => node.type)).toEqual([
      "paragraph",
      "list",
    ]);
    const table = ast.children.find((node) => node.type === "table");
    expect(table?.spans?.[1]?.[2]).toEqual({ rowspan: 2, colspan: 1 });
    expect(table?.spans?.[2]?.[2]).toBeNull();
    expect(table?.spans?.[5]?.[2]).toEqual({ rowspan: 2, colspan: 1 });
    expect(table?.spans?.[6]?.[2]).toBeNull();
    expect(parseMarkdown(serializeMarkdown(ast.children)).ast).toEqual(ast);
    const original = JSON.stringify(source);
    const converted = convertSourceToCnoi(source);
    if (!converted.ok) throw new Error(converted.message);
    const document = parseProblemMarkdown(
      converted.value.cnoiMarkdown,
      converted.value,
    );
    if (!document.ok) throw new Error(document.message);
    expect(
      document.value.ast.children.find((node) => node.type === "list"),
    ).toEqual(list);
    expect(
      document.value.ast.children.find((node) => node.type === "table"),
    ).toEqual(table);
    expect(JSON.stringify(source)).toBe(original);
    if (process.env.OJTRACE_QA_DIR) {
      mkdirSync(process.env.OJTRACE_QA_DIR, { recursive: true });
      writeFileSync(
        resolve(process.env.OJTRACE_QA_DIR, "hydroj-tree.source.md"),
        source.sourceMarkdown,
      );
    }
  });

  it("keeps authored toolbars, Copy text and literal sample data", async () => {
    const result = await hydrojProblemAdapter.extractSource(
      createSnapshot({
        url: treeUrl,
        html: '<h1>Original</h1><div data-fragment-id="problem-description"><p>Author says Copy this input carefully. Original explanatory content stays.</p><div class="toolbar"><button>Copy author text</button></div><div class="code-toolbar"><pre><code>Copy\n$literal$\n</code></pre><div class="toolbar"><a href="javascript:;">Copy</a></div></div></div>',
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.source.sourceMarkdown).toContain("Copy author text");
    expect(result.source.sourceMarkdown).toContain(
      "Author says Copy this input carefully.",
    );
    expect(
      parseMarkdown(result.source.sourceMarkdown).ast.children.filter(
        (node) => node.type === "code",
      ),
    ).toEqual([{ type: "code", value: "Copy\n$literal$" }]);
  });
});
