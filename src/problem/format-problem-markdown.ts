import type { ProblemDocument } from "./domain";
import { problemDisplayName } from "./domain";

/** Problem statement plus the title and limits omitted from the body markdown. */
export function formatProblemMarkdown(document: ProblemDocument): string {
  const title = problemHeading(document);
  const details = [
    `- 来源：${problemDisplayName(document.oj)}`,
    document.originalUrl.trim() ? `- 原题：${document.originalUrl.trim()}` : "",
    document.timeLimit?.display.trim()
      ? `- 时间限制：${document.timeLimit.display.trim()}`
      : "",
    document.memoryLimit?.display.trim()
      ? `- 内存限制：${document.memoryLimit.display.trim()}`
      : "",
  ].filter(Boolean);
  const statement = document.markdown.trim();
  const parts = [
    title ? `# ${title}` : "",
    details.join("\n"),
    statement,
  ].filter(Boolean);
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

function problemHeading(document: ProblemDocument): string {
  const id = compact(document.problemId);
  const title = compact(document.title);
  if (!title || title === id) return id;
  if (
    title.startsWith(`${id} `) ||
    title.startsWith(`${id}.`) ||
    title.startsWith(`${id}:`) ||
    title.startsWith(`${id}：`)
  ) {
    return title;
  }
  return id ? `${id} ${title}` : title;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
