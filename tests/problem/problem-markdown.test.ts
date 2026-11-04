import { serializeMarkdown } from "../../src/problem/markdown/serialize";
import { describe, expect, it } from "vitest";
import {
  parseProblemMarkdown,
  readProblemMarkdown,
  serializeProblemMarkdown,
} from "../../src/problem/problem-markdown";
import type { RenderDocument } from "../../src/problem/domain";
import { problemDocumentToTypst } from "../../src/problem/render/template";
import {
  FRONT_MATTER_LIMIT,
  frontMatterRange,
} from "../../src/problem/markdown-front-matter";

const fullUrl = "https://cdn.example/figures/full.png";
const missingUrl = "https://cdn.example/figures/missing.png";
const removedUrl = "https://cdn.example/figures/removed.png";
const prefixUrl = "https://cdn.example/figures/full";
const body = "## 题目描述\n\n原题。\n";
const source = `---
oj: luogu
id: P6187
title: "[NOI Online #1 提高组] 最小环"
url: https://www.luogu.com.cn/problem/P6187
time_limit: 2 s
memory_limit: 250 MB
language: zh
---

${body}`;

function baseDocument(): RenderDocument {
  return {
    oj: "luogu",
    problemId: "P6187",
    title: "[NOI Online #1 提高组] 最小环",
    originalUrl: "https://www.luogu.com.cn/problem/P6187",
    timeLimit: { display: "2 s", milliseconds: 2_000 },
    memoryLimit: { display: "250 MB", bytes: 250 * 1024 ** 2 },
    language: "zh",

    ast: {
      type: "root" as const,
      children: [
        {
          type: "heading",
          level: 2,
          children: [{ type: "text", value: "题目描述" }],
        },
        { type: "paragraph", children: [{ type: "text", value: "原题。" }] },
      ],
    },
    assets: [
      {
        sourceUrl: fullUrl,
        dataUrl: "data:image/png;base64,QQ==",
        mimeType: "image/png",
      },
      { sourceUrl: missingUrl },
      { sourceUrl: removedUrl },
    ],
    warnings: [
      { code: "math-unrecognized", message: "公式未识别。" },
      {
        code: "image-unembedded",
        message: `图片无法嵌入 PDF，已保留原图链接：${missingUrl}`,
      },
      {
        code: "image-unembedded",
        message: `图片无法嵌入 PDF，已保留原图链接：${removedUrl}`,
      },
    ],
  };
}

describe("problem Markdown front matter", () => {
  it("serializes exactly one editable front matter followed by the statement", () => {
    const base = baseDocument();
    expect(
      serializeProblemMarkdown(base, serializeMarkdown(base.ast.children)),
    ).toBe(source);
    const result = parseProblemMarkdown(source, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      oj: "luogu",
      problemId: "P6187",
      title: "[NOI Online #1 提高组] 最小环",
      originalUrl: "https://www.luogu.com.cn/problem/P6187",
      timeLimit: { display: "2 s", milliseconds: 2000 },
      memoryLimit: { display: "250 MB", bytes: 250 * 1024 ** 2 },
      ast: baseDocument().ast,
      language: "zh",
    });
    expect(result.value.ast.children).toEqual(base.ast.children);
    expect(result.value.ast.children).not.toBe(base.ast.children);
    expect(JSON.stringify(result.value.ast.children)).not.toContain(
      "memory_limit",
    );
  });

  it("uses edited metadata for every renderer field, with no original-value fallback", () => {
    const changed = source
      .replace("oj: luogu", "oj: atcoder")
      .replace("id: P6187", "id: abc300_a")
      .replace('title: "[NOI Online #1 提高组] 最小环"', 'title: "New title"')
      .replace(
        "https://www.luogu.com.cn/problem/P6187",
        "https://atcoder.jp/contests/abc300/tasks/abc300_a",
      )
      .replace("time_limit: 2 s", "time_limit: 3 s")
      .replace("memory_limit: 250 MB", "memory_limit: 512 MB");
    const result = parseProblemMarkdown(changed, baseDocument());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      oj: "atcoder",
      problemId: "abc300_a",
      title: "New title",
      originalUrl: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
      timeLimit: { display: "3 s", milliseconds: 3000 },
      memoryLimit: { display: "512 MB", bytes: 512 * 1024 ** 2 },
    });
    const typst = problemDocumentToTypst(result.value);
    for (const text of [
      "AtCoder",
      "abc300\\_a",
      "New title",
      "3 s",
      "512 MB",
      "原题。",
    ])
      expect(typst).toContain(text);
    expect(typst).not.toContain("P6187");
    expect(typst).not.toContain("time_limit");
  });

  it("clears omitted or blank limits instead of taking them from the captured problem", () => {
    for (const changed of [
      source.replace(/^time_limit:.*\n|^memory_limit:.*\n/gm, ""),
      source
        .replace("time_limit: 2 s", 'time_limit: ""')
        .replace("memory_limit: 250 MB", 'memory_limit: ""'),
    ]) {
      const result = parseProblemMarkdown(changed, baseDocument());
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.timeLimit).toBeUndefined();
      expect(result.value.memoryLimit).toBeUndefined();
    }
  });

  it("quotes special titles and keeps numeric-looking IDs and literal TeX unchanged", () => {
    const base = {
      ...baseDocument(),
      oj: "qoj" as const,
      problemId: "00123",
      title: '题目: #1 "引号" \\alpha',
    };
    const serialized = serializeProblemMarkdown(
      base,
      serializeMarkdown(base.ast.children),
    );
    const parsed = parseProblemMarkdown(serialized, baseDocument());
    expect(parsed.ok && parsed.value.title).toBe(base.title);
    expect(parsed.ok && parsed.value.problemId).toBe("00123");
    const unquoted = readProblemMarkdown(
      source.replace("id: P6187", "id: 0001234567890123456789"),
    );
    expect(unquoted.ok && unquoted.value.metadata.problemId).toBe(
      "0001234567890123456789",
    );
  });

  it("supports BOM, CRLF, comments and quoted colons without eating body separators", () => {
    const changed =
      source
        .replace("id: P6187", "id: P6187 # comment")
        .replace(
          'title: "[NOI Online #1 提高组] 最小环"',
          'title: "title: #quoted"',
        ) + "\n---\n\n后文。\n";
    const read = readProblemMarkdown(
      "\uFEFF" + changed.replaceAll("\n", "\r\n"),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.metadata.title).toBe("title: #quoted");
    expect(read.value.metadata.problemId).toBe("P6187");
    expect(read.value.body).toContain("\r\n---\r\n\r\n后文。");
  });

  it.each([
    [source.slice(4), "开头"],
    [source.replace("\n---\n\n", "\n\n"), "尚未结束"],
    [source.replace("id: P6187", "id: P6187\nid: P1"), "重复字段"],
    [source.replace(/^title:.*$/m, 'title: "unterminated'), "格式有误"],
    [source.replace("oj: luogu", "oj: unknown"), "oj"],
    [source.replace("id: P6187", "id:"), "id"],
    [source.replace("language: zh", "language: [en, ja]"), "language"],
    [source.replace(/^title:.*$/m, 'title: ""'), "title"],
    [source.replace(/^url:.*$/m, "url: javascript:alert(1)"), "url"],
    [source.replace("time_limit: 2 s", "time_limit: [2, s]"), "time_limit"],
    [
      source.replace("memory_limit: 250 MB", "memory_limit: {amount: 250}"),
      "memory_limit",
    ],
    [source.replace("id: P6187", "id: &id P6187\nextra: *id"), "别名"],
    ["---\n- not a mapping\n---\n\n正文", "字段映射"],
  ])(
    "rejects invalid metadata without using captured values: %s",
    (changed, expected) => {
      const result = parseProblemMarkdown(changed, baseDocument());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain(expected);
    },
  );

  it("rejects an empty statement and an unfinished oversized header", () => {
    const empty = parseProblemMarkdown(
      source.replace(body, ""),
      baseDocument(),
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toContain("正文为空");
    const oversized = readProblemMarkdown("---\ntitle: " + "x".repeat(20_000));
    expect(oversized.ok).toBe(false);
    const prefix = "---\n# " + "x".repeat(FRONT_MATTER_LIMIT - 10) + "\n";
    expect(frontMatterRange(prefix + "---not a delimiter\n")?.closed).toBe(
      false,
    );
  });

  it("never substitutes captured AST nodes for the Markdown body", () => {
    const base = {
      ...baseDocument(),
      ast: {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [{ type: "text" as const, value: "stale AST" }],
          },
        ],
      },
    };
    const result = parseProblemMarkdown(source, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value.ast.children)).toContain("原题。");
    expect(JSON.stringify(result.value.ast.children)).not.toContain(
      "stale AST",
    );
  });

  it("preserves user headings without rerunning the initial Transformer", () => {
    const base = baseDocument();
    const serialized = serializeProblemMarkdown(
      { ...base },
      `# ${base.title}\n\n正文。\n`,
    );
    expect(readProblemMarkdown(serialized)).toMatchObject({
      ok: true,
      value: { body: `# ${base.title}\n\n正文。\n` },
    });
    expect(serialized).toContain(`# ${base.title}`);
    const parsed = parseProblemMarkdown(
      source.replace(body, `# ${base.title}\n\n${body}`),
      base,
    );
    expect(
      parsed.ok &&
        parsed.value.ast.children.some(
          (block) => block.type === "heading" && block.level === 1,
        ),
    ).toBe(true);
  });

  it("reattaches images by full URL and drops warnings for removed images", () => {
    const markdown = [
      "## 题目描述",
      "",
      "计算 $a+b$。",
      "",
      `![示意图](${fullUrl})`,
      "",
      `![缺图](${missingUrl})`,
      "",
      `![前缀](${prefixUrl})`,
      "",
    ].join("\n");
    const result = parseProblemMarkdown(
      source.replace(body, markdown),
      baseDocument(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assets).toEqual([
      expect.objectContaining({
        sourceUrl: fullUrl,
        dataUrl: "data:image/png;base64,QQ==",
        mimeType: "image/png",
      }),
      expect.objectContaining({ sourceUrl: missingUrl }),
      expect.objectContaining({ sourceUrl: prefixUrl }),
    ]);
    expect(
      result.value.assets.find((asset) => asset.sourceUrl === prefixUrl)
        ?.dataUrl,
    ).toBeUndefined();
    expect(result.value.assets.map((asset) => asset.sourceUrl)).not.toContain(
      removedUrl,
    );
    expect(result.value.warnings).toEqual([
      { code: "math-unrecognized", message: "公式未识别。" },
      {
        code: "image-unembedded",
        message: `图片无法嵌入 PDF，已保留原图链接：${missingUrl}`,
      },
    ]);
  });

  it("resolves relative images against the URL in front matter", () => {
    const edited = source
      .replace(/^url:.*$/m, "url: https://qoj.ac/problem/42")
      .replace(body, "## 题目描述\n\n![图](figure.png)\n");
    const result = parseProblemMarkdown(edited, baseDocument());
    expect(result.ok && result.value.assets[0]?.sourceUrl).toBe(
      "https://qoj.ac/problem/figure.png",
    );
  });
});
