import { PROBLEM_MARKDOWN_LIMIT } from "./budget";
import { isMap, parseDocument, Scalar, stringify } from "yaml";
import { isSourceId } from "../domain/types";
import type { RenderDocument, ProblemMetadata, CnoiProblem } from "./domain";
import { parseMarkdown } from "./markdown/parse";
import { parseMemoryLimit, parseTimeLimit } from "./extract/metadata";
import { frontMatterRange } from "./markdown-front-matter";
import { problemLabels } from "./localization";
import { mergeCapturedImages } from "./merge-images";

type MarkdownResult<T> =
  { ok: true; value: T } | { ok: false; message: string };

/** Serialized editor source. Extraction/copy APIs still keep statement-only Markdown. */
export function serializeProblemMarkdown(
  document: ProblemMetadata,
  body: string,
): string {
  const title = new Scalar(document.title);
  title.type = Scalar.QUOTE_DOUBLE;
  const header = stringify(
    {
      oj: document.oj,
      id: document.problemId,
      title,
      url: document.originalUrl,
      time_limit: document.timeLimit?.display ?? "",
      memory_limit: document.memoryLimit?.display ?? "",
      ...(document.language ? { language: document.language } : {}),
    },
    { lineWidth: 0 },
  );
  return `---\n${header}---\n\n${body.trim()}\n`;
}

/** Read the header only, for the breadcrumb and the document conversion below. */
export function readProblemMarkdown(
  markdown: string,
): MarkdownResult<{ metadata: ProblemMetadata; body: string }> {
  const range = frontMatterRange(markdown);
  if (!range)
    return {
      ok: false,
      message: "请在文档开头使用 --- 包围的 front matter 填写题目元信息。",
    };
  if (!range.closed)
    return {
      ok: false,
      message: "front matter 尚未结束或过长，请用单独一行 --- 结束元信息。",
    };
  try {
    const yaml = parseDocument(
      markdown.slice(range.contentFrom, range.contentTo),
      {
        schema: "failsafe",
        uniqueKeys: true,
        stringKeys: true,
        prettyErrors: false,
      },
    );
    const error = yaml.errors[0];
    if (error) {
      const line = markdown
        .slice(0, range.contentFrom + error.pos[0])
        .split("\n").length;
      return {
        ok: false,
        message: `front matter 第 ${line} 行${error.code === "DUPLICATE_KEY" ? "存在重复字段" : "格式有误，请检查引号、冒号和缩进"}。`,
      };
    }
    if (!isMap(yaml.contents) || yaml.warnings.length)
      return {
        ok: false,
        message: "front matter 必须是 YAML 字段映射，请使用文本值。",
      };
    // Flat metadata needs no alias expansion, and a Map avoids special object keys.
    const fields: Map<unknown, unknown> = yaml.toJS({
      mapAsMap: true,
      maxAliasCount: 0,
    });
    for (const key of ["oj", "id", "title", "url"] as const) {
      if (
        typeof fields.get(key) !== "string" ||
        !String(fields.get(key)).trim()
      )
        return {
          ok: false,
          message: `front matter 的 ${key} 必须填写非空文本。`,
        };
    }
    const source = text(fields, "oj");
    if (!isSourceId(source))
      return {
        ok: false,
        message:
          "front matter 的 oj 必须是 luogu、codeforces、atcoder、qoj 或 hydroj。",
      };
    const url = text(fields, "url");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        ok: false,
        message: "front matter 的 url 必须是完整的 HTTP 或 HTTPS 地址。",
      };
    }
    if (!/^https?:$/.test(parsedUrl.protocol))
      return {
        ok: false,
        message: "front matter 的 url 必须是完整的 HTTP 或 HTTPS 地址。",
      };
    for (const key of ["time_limit", "memory_limit"]) {
      const value = fields.get(key);
      if (value != null && typeof value !== "string")
        return {
          ok: false,
          message: `front matter 的 ${key} 必须是文本，例如 ${key === "time_limit" ? "2 s" : "250 MB"}。`,
        };
    }
    if (fields.has("language") && typeof fields.get("language") !== "string")
      return { ok: false, message: "front matter 的 language 必须是文本。" };
    const language = text(fields, "language");
    if (language && !["zh", "en", "ja", "other"].includes(language))
      return {
        ok: false,
        message: "front matter 的 language 必须是 zh、en、ja 或 other。",
      };
    const metadata: ProblemMetadata = {
      oj: source,
      problemId: text(fields, "id"),
      title: text(fields, "title"),
      originalUrl: url,
      ...(language
        ? { language: language as "zh" | "en" | "ja" | "other" }
        : {}),
      ...optionalLimits(
        text(fields, "time_limit"),
        text(fields, "memory_limit"),
      ),
    };
    return {
      ok: true,
      value: {
        metadata,
        body: markdown.slice(range.bodyFrom).replace(/^(?:[\t ]*\r?\n)+/, ""),
      },
    };
  } catch {
    return {
      ok: false,
      message:
        "front matter 无法解析，请使用普通 YAML 文本字段，不要使用别名。",
    };
  }
}

/** The sole editor pipeline: complete Markdown -> document -> existing renderer. */
export function parseProblemMarkdown(
  markdown: string,
  resources: Pick<CnoiProblem, "assets" | "warnings">,
): MarkdownResult<RenderDocument> {
  if (
    markdown.length > PROBLEM_MARKDOWN_LIMIT ||
    new TextEncoder().encode(markdown).byteLength > PROBLEM_MARKDOWN_LIMIT
  )
    return { ok: false, message: "题面 Markdown 过大，无法解析。" };
  const read = readProblemMarkdown(markdown);
  if (!read.ok) return read;
  const { metadata } = read.value;
  const body = read.value.body;
  const language = metadata.language;
  const labels = problemLabels(language);
  try {
    const parsed = parseMarkdown(body, { baseUrl: metadata.originalUrl });
    if (!parsed.ast.children.length)
      return {
        ok: false,
        message: "题面正文为空，请在 front matter 后填写题目描述。",
      };
    const merged = mergeCapturedImages(
      parsed.assets,
      resources.warnings.filter(
        (warning) => warning.code === "image-unembedded",
      ),
      resources.assets,
      undefined,
    );
    const kept = resources.warnings.filter(
      (warning) => warning.code !== "image-unembedded",
    );
    const referenced = new Set(merged.assets.map((asset) => asset.sourceUrl));
    const imageWarnings = merged.warnings.filter(
      (warning) =>
        warning.code === "image-unembedded" &&
        [...referenced].some((url) => warning.message.endsWith(`：${url}`)),
    );
    return {
      ok: true,
      value: {
        oj: metadata.oj,
        problemId: metadata.problemId,
        title: metadata.title,
        originalUrl: metadata.originalUrl,
        ...(metadata.timeLimit ? { timeLimit: metadata.timeLimit } : {}),
        ...(metadata.memoryLimit ? { memoryLimit: metadata.memoryLimit } : {}),
        ...(language ? { language } : {}),
        ...(labels
          ? {
              displayLabels: {
                timeLimit: labels.timeLimit,
                memoryLimit: labels.memoryLimit,
                page: labels.page,
              },
            }
          : {}),
        ast: parsed.ast,
        assets: merged.assets,
        warnings: [...kept, ...parsed.warnings, ...imageWarnings],
      },
    };
  } catch {
    return {
      ok: false,
      message: "题面 Markdown 无法解析，请检查格式后再导出。",
    };
  }
}

function text(fields: Map<unknown, unknown>, key: string): string {
  const value = fields.get(key);
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function optionalLimits(
  time: string,
  memory: string,
): Pick<ProblemMetadata, "timeLimit" | "memoryLimit"> {
  const timeLimit = parseTimeLimit(time);
  const memoryLimit = parseMemoryLimit(memory);
  return {
    ...(timeLimit ? { timeLimit } : {}),
    ...(memoryLimit ? { memoryLimit } : {}),
  };
}
