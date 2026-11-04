import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { atcoderProblemAdapter } from "../../src/problem/adapters/atcoder";
import { convertSourceToCnoi } from "../../src/problem/cnoi/convert";
import { parseMarkdown } from "../../src/problem/markdown/parse";
import { parseProblemMarkdown } from "../../src/problem/problem-markdown";
import { inlineText } from "../../src/problem/markdown/text";
import { createSnapshot } from "./snapshot-fixtures";
import { atcoderFixture } from "./atcoder-fixture";

async function extract(html: string, language: "en" | "ja" = "en") {
  const result = await atcoderProblemAdapter.extractSource(
    createSnapshot({
      url: `https://atcoder.jp/contests/abc391/tasks/abc391_g?lang=${language}`,
      html,
      title: "G - Many LCS - AtCoder",
    }),
  );
  if (!result.ok) throw new Error(result.message ?? result.reason);
  return result.source;
}

describe("AtCoder Source fidelity", () => {
  it.each([false, true])(
    "matches the entire original English statement with Copy controls (rendered math: %s)",
    async (rendered) => {
      const source = await extract(
        atcoderFixture({ language: "en", rendered, copyControls: true }),
      );
      expect(source.metadata).toMatchObject({
        title: "G - Many LCS",
        problemId: "abc391_g",
        language: "en",
        timeLimit: { milliseconds: 2000 },
        memoryLimit: { bytes: 1024 ** 3 },
      });
      expect(source.sourceMarkdown).toBe(
        readFileSync(
          "tests/problem/fixtures/atcoder-abc391-g.en.source.md",
          "utf8",
        ).replaceAll("\r\n", "\n"),
      );
      expect(source.sourceMarkdown).not.toMatch(
        /Copy|<pre|<span|data-ojtrace|rendered glyphs|duplicated visual/,
      );
      expect(source.warnings).toEqual([]);
      const ast = parseMarkdown(source.sourceMarkdown).ast;
      expect(
        ast.children.filter((node) => node.type === "thematic-break"),
      ).toHaveLength(4);
      const code = ast.children.filter((node) => node.type === "code");
      expect(code).toHaveLength(8);
      expect(code[0]).toMatchObject({
        value: "N M\nS",
        lines: [
          [
            { type: "inline-math", value: "N" },
            { type: "text", value: " " },
            { type: "inline-math", value: "M" },
          ],
          [{ type: "inline-math", value: "S" }],
        ],
      });
      expect(
        code[1]?.lines?.[0]
          ?.filter((node) => node.type === "inline-math")
          .map((node) => node.value),
      ).toEqual([
        String.raw`\mathrm{ans}_0`,
        String.raw`\mathrm{ans}_1`,
        String.raw`\ldots`,
        String.raw`\mathrm{ans}_N`,
      ]);
      const original = JSON.stringify(source);
      const converted = convertSourceToCnoi(source);
      if (!converted.ok) throw new Error(converted.message);
      const parsed = parseProblemMarkdown(
        converted.value.cnoiMarkdown,
        converted.value,
      );
      if (!parsed.ok) throw new Error(parsed.message);
      expect(
        parsed.value.ast.children.filter((node) => node.type === "code"),
      ).toEqual(code);
      expect(JSON.stringify(source)).toBe(original);
      if (process.env.OJTRACE_QA_DIR) {
        mkdirSync(process.env.OJTRACE_QA_DIR, { recursive: true });
        writeFileSync(
          resolve(process.env.OJTRACE_QA_DIR, "atcoder-abc391-g.source.md"),
          source.sourceMarkdown,
        );
      }
    },
  );

  it.each([false, true])(
    "retains the selected Japanese version, its original levels and numbering (rendered: %s)",
    async (rendered) => {
      const source = await extract(
        atcoderFixture({ language: "ja", rendered, copyControls: true }),
        "ja",
      );
      expect(source.metadata.language).toBe("ja");
      expect(source.sourceMarkdown).toContain("配点 : $600$ 点");
      expect(source.sourceMarkdown).toContain(
        "各 $k=0,1,\\ldots,N$ に対して以下の問題を解いてください。",
      );
      expect(source.sourceMarkdown).not.toMatch(
        /Copy|Problem Statement|Sample Input|Score/,
      );
      expect(
        parseMarkdown(source.sourceMarkdown).ast.children.flatMap((node) =>
          node.type === "heading"
            ? [[node.level, inlineText(node.children)]]
            : [],
        ),
      ).toEqual(
        [
          "問題文",
          "制約",
          "入力",
          "出力",
          "入力例 1",
          "出力例 1",
          "入力例 2",
          "出力例 2",
          "入力例 3",
          "出力例 3",
        ].map((title) => [3, title]),
      );
      const native = await extract(atcoderFixture({ language: "ja" }), "ja");
      expect(source.sourceMarkdown).toBe(native.sourceMarkdown);
    },
  );

  it("removes known UI nodes while retaining authored Copy text, code and buttons", async () => {
    const source = await extract(
      '<span class="h2">Original</span><div id="task-statement"><h3>Sample Input 7<span class="btn-copy">Copy</span></h3><div class="div-btn-copy"><span>Copy</span></div><pre>Copy\n$N$\n</pre><pre class="source-code-for-copy">hidden duplicate</pre><p>Copy the string. <button>Copy</button></p><h4>Author subheading</h4></div>',
    );
    expect(source.sourceMarkdown).toContain("### Sample Input 7\n");
    expect(source.sourceMarkdown).toContain("Copy the string. Copy");
    expect(source.sourceMarkdown).toContain("#### Author subheading");
    expect(source.sourceMarkdown).not.toContain("hidden duplicate");
    expect(
      parseMarkdown(source.sourceMarkdown).ast.children.filter(
        (node) => node.type === "code",
      ),
    ).toEqual([{ type: "code", value: "Copy\n$N$" }]);
  });
});
