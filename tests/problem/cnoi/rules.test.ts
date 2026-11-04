import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertSourceToCnoi } from "../../../src/problem/cnoi/convert";
import {
  ruleCatalog,
  resolveRules,
  minimizeOverrides,
  ojRules,
} from "../../../src/problem/cnoi/rules/config";
import {
  validateCnoiOverrides,
  type CnoiRuleOverrides,
} from "../../../src/domain/cnoi-rules";
import { readProblemMarkdown } from "../../../src/problem/problem-markdown";
import type { SourceId } from "../../../src/domain/types";

function convert(
  markdown: string,
  overrides: CnoiRuleOverrides = {},
  oj: SourceId = "codeforces",
  language: "en" | "ja" | "zh" = "en",
) {
  const source = {
    sourceMarkdown: markdown,
    metadata: {
      oj,
      problemId: "fixture-1",
      title: "Fixture",
      originalUrl: "https://example.org/p/1",
      language,
    },
    assets: [],
    warnings: [],
  };
  const before = JSON.stringify(source);
  const result = convertSourceToCnoi(source, overrides);
  expect(JSON.stringify(source)).toBe(before);
  if (!result.ok) throw new Error(result.message);
  const read = readProblemMarkdown(result.value.cnoiMarkdown);
  if (!read.ok) throw new Error(read.message);
  return { body: read.value.body, warnings: result.value.warnings };
}
describe("declarative CNOI configuration", () => {
  it("preserves child hierarchy when sample wrapping is retained", () => {
    const source =
      "## Examples\n\n### Input\n\n```\n1\n```\n\n### Output\n\n```\n2\n```\n";
    const result = convert(source, { unwrapSamples: false });
    expect(result.body).toContain("## Examples\n");
    expect(result.body).toContain("### Sample Input\n");
    expect(result.body).toContain("### Sample Output\n");
    expect(convert(source).body).toContain("## Sample Input\n");
  });
  it("resolves redundant draft attributes identically to persisted sparse overrides", () => {
    expect(
      resolveRules("codeforces", {
        mappings: {
          "common.hint": {
            role: "hint",
            contexts: [
              { kind: "root" },
              { kind: "parent", role: "description" },
            ],
          },
        },
      }),
    ).toEqual(resolveRules("codeforces"));
  });
  it("does not mistake Input/Output for sample numbers and keeps unsafe depth intact", () => {
    const source =
      "## Sample Input\n\n```\n1\n```\n\n## Sample Output\n\n```\n2\n```\n";
    expect(convert(source, { headingMode: "canonical" }).body).toBe(source);
    expect(
      convert(source, {
        mappings: { "common.sample-input": { enabled: false } },
      }).warnings.some((w) => w.code === "cnoi-unrecognized"),
    ).toBe(true);
    const deep = "## Input\n\nFormat.\n\n### Details\n\nContent.\n";
    const result = convert(deep, { sectionLevel: 6 });
    expect(result.body).toBe(deep);
    expect(result.warnings.some((w) => w.code === "cnoi-heading-depth")).toBe(
      true,
    );
  });
  it("keeps rich wrapper headings and preserves arbitrary literal numbering templates", () => {
    const source =
      "## [Examples](https://example.org/context)\n\n### Input\n\n```\n1\n```\n";
    const result = convert(source);
    expect(result.body).toContain("https://example.org/context");
    expect(result.warnings.some((w) => w.code === "cnoi-rich-title")).toBe(
      true,
    );
    const numbered = convert(
      "## Test VII section\n\n### Input\n\n1\n\n### Output\n\n2\n",
      {
        numbering: "inherit-group",
        customRules: [
          {
            id: "user-group",
            enabled: true,
            role: "samples",
            contexts: [{ kind: "root" }],
            matcher: {
              kind: "numbered",
              text: "Test {number} section",
              required: true,
            },
          },
        ],
      },
    );
    expect(numbered.body).toContain("## Sample Input #VII");
    expect(numbered.body).toContain("## Sample Output #VII");
  });
  it("lets explicit default overrides win over overlapping inherited matches", () => {
    expect(
      convert("## Note\n\nText.\n", {
        mappings: { "common.hint": { role: "output" } },
        headingMode: "canonical",
      }).body,
    ).toContain("## Output");
  });
  it("freezes defaults and resolves independent configurations", () => {
    expect(Object.isFrozen(ojRules.codeforces.mappings[0])).toBe(true);
    const a = resolveRules("codeforces", { sectionLevel: 4 });
    a.order.reverse();
    a.mappings[0]!.enabled = false;
    expect(resolveRules("codeforces").sectionLevel).toBe(2);
    expect(resolveRules("qoj").mappings[0]!.enabled).toBe(true);
    expect(
      minimizeOverrides("codeforces", {
        sectionLevel: 2,
        mappings: { "common.input": { enabled: true } },
        customRules: [],
      }),
    ).toEqual({});
  });
  it("rejects executable, arbitrary-regex, invalid contexts, templates and foreign rules", () => {
    for (const value of [
      { js: "alert(1)" },
      { sectionLevel: 7 },
      { order: ["input"] },
      {
        customRules: [
          {
            id: "user-a",
            enabled: true,
            role: "input",
            contexts: [{ kind: "root" }],
            matcher: { kind: "regex", text: ".*" },
          },
        ],
      },
      { sampleTemplates: { en: { input: "{eval(x)}", output: "Output" } } },
    ])
      expect(validateCnoiOverrides(value).length).toBeGreaterThan(0);
    expect(() =>
      resolveRules("codeforces", {
        mappings: { "qoj.input": { enabled: false } },
      }),
    ).toThrow("不属于当前 OJ");
  });
  it("disables contextual mapping without resurrecting aliases", () => {
    const source =
      "## Input\n\nFormat.\n\n## Examples\n\n### Input\n\n```\n1\n```\n\n### Output\n\n```\n2\n```\n";
    expect(convert(source).body).toContain("## Sample Input");
    const result = convert(source, {
      mappings: { "context.sample-input": { enabled: false } },
    });
    expect(result.body).not.toContain("Sample Input");
    expect(result.body).toContain("Format.");
    expect(result.body).toContain("```\n1\n```");
    expect(result.warnings.some((w) => w.code === "cnoi-unrecognized")).toBe(
      true,
    );
  });
  it("overrides an enabled default's role and uses explicit custom precedence", () => {
    const source = "## Input\n\nFormat.\n";
    expect(
      convert(source, {
        mappings: { "common.input": { role: "hint" } },
        headingMode: "canonical",
      }).body,
    ).toContain("## Notes");
    const custom = {
      id: "user-a",
      enabled: true,
      role: "description" as const,
      contexts: [{ kind: "root" as const }],
      matcher: { kind: "exact" as const, text: "Input" },
    };
    expect(
      convert(source, { customRules: [custom], headingMode: "canonical" }).body,
    ).toContain("## Problem Statement");
    const conflict = convert(source, {
      customRules: [custom, { ...custom, id: "user-b", role: "output" }],
    });
    expect(conflict.body).toBe(source);
    expect(conflict.warnings[0]?.code).toBe("cnoi-ambiguous");
  });
  it("respects parent and ancestor contexts and explanation barriers", () => {
    const source =
      "## Examples\n\n### Sample Input 1\n\n#### Payload\n\nKeep.\n\n### Explanation\n\n#### Payload\n\nProse.\n";
    const result = convert(source, {
      customRules: [
        {
          id: "user-ancestor",
          enabled: true,
          role: "hint",
          contexts: [{ kind: "ancestor", role: "samples" }],
          matcher: { kind: "exact", text: "Payload" },
        },
      ],
      headingMode: "canonical",
    });
    expect(result.body).toContain("### Notes");
    expect(result.body).toContain("### Payload");
    expect(result.body).toContain("Prose.");
  });
  it("supports safe numbered matchers and explicit inheritance without renumbering existing IDs", () => {
    const source =
      "## Test 7\n\n### Input\n\n```\n1\n```\n\n### Output #A\n\n```\n2\n```\n";
    const result = convert(source, {
      customRules: [
        {
          id: "user-test",
          enabled: true,
          role: "samples",
          contexts: [{ kind: "root" }],
          matcher: { kind: "numbered", text: "Test {number}", required: true },
        },
      ],
      numbering: "inherit-group",
    });
    expect(result.body).toContain("## Sample Input #7");
    expect(result.body).toContain("## Sample Output #A");
    expect(result.warnings.some((w) => w.code === "cnoi-number-conflict")).toBe(
      true,
    );
  });
  it("uses language-specific heading and sample templates", () => {
    const source = "## Input\n\nFormat.\n\n## Sample Input 7\n\n```\n1\n```\n";
    expect(
      convert(source, {
        headingMode: "canonical",
        labels: { en: { input: "Data" } },
        sampleTitleMode: "template",
        sampleTemplates: {
          en: {
            input: "Case{numberSuffix} input",
            output: "Case{numberSuffix} output",
          },
        },
      }).body,
    ).toContain("## Case #7 input");
    expect(
      convert(
        "## 入力\n\n本文\n",
        { headingMode: "canonical" },
        "atcoder",
        "ja",
      ).body,
    ).not.toContain("输入");
  });
  it.each([
    ["luogu", "fields"],
    ["codeforces", "context"],
    ["atcoder", "japanese"],
    ["qoj", "wrapper"],
    ["hydroj", "chinese"],
  ] as const)("runs real %s Source fixtures with overrides", (oj, name) => {
    const source = readFileSync(
      `tests/problem/fixtures/source-markdown/${oj}/${name}.source.md`,
      "utf8",
    );
    const result = convert(
      source,
      { sectionLevel: 3, unwrapSamples: false },
      oj,
      oj === "atcoder" ? "ja" : "en",
    );
    expect(result.body.length).toBeGreaterThan(0);
    expect(
      ruleCatalog(oj).rules.every(
        (r) =>
          r.id.startsWith("common.") ||
          r.id.startsWith("context.") ||
          r.id.startsWith(`${oj}.`),
      ),
    ).toBe(true);
  });
  it("preserves rich blocks, repeated examples, unknown anchors and source ordering", () => {
    const source =
      "## Output\n\nEnd.\n\n## Unknown\n\n![x](https://example.org/x.png)\n\n$$\nx^2\n$$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n## Input\n\n```\n x  \n```\n\n## Sample Input 7\n\n```\n x  \n```\n";
    const result = convert(source, { reorder: false });
    expect(result.body.indexOf("Output")).toBeLessThan(
      result.body.indexOf("Unknown"),
    );
    for (const content of [
      "https://example.org/x.png",
      "x^2",
      "| 1 | 2 |",
      " x  ",
    ])
      expect(result.body).toContain(content);
    expect(result.body.match(/ x  /gu)).toHaveLength(2);
  });
});
