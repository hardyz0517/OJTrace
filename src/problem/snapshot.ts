import {
  PROBLEM_PROBE_HTML_LIMIT,
  PROBLEM_SNAPSHOT_HTML_LIMIT,
} from "./budget";
import type { ProblemPageProbe, ProblemPageSnapshot } from "./domain";

export function normalizeBaseUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

export function createProbe(input: {
  url: string;
  title?: string;
  html?: string;
}): ProblemPageProbe {
  const html = input.html ?? "";
  return {
    url: input.url,
    title: input.title?.trim() ?? "",
    htmlFragment:
      html.length > PROBLEM_PROBE_HTML_LIMIT
        ? html.slice(0, PROBLEM_PROBE_HTML_LIMIT)
        : html,
    baseUrl: normalizeBaseUrl(input.url),
  };
}

export function createSnapshot(input: {
  url: string;
  title?: string;
  html: string;
  language?: ProblemPageSnapshot["language"];
  sourceData?: ProblemPageSnapshot["sourceData"];
  capturedAt?: number;
}): ProblemPageSnapshot {
  if (input.html.length > PROBLEM_SNAPSHOT_HTML_LIMIT) {
    throw new Error("Problem snapshot exceeds size limit");
  }
  return {
    url: input.url,
    title: input.title?.trim() ?? "",
    html: input.html,
    baseUrl: normalizeBaseUrl(input.url),
    ...(input.language ? { language: input.language } : {}),
    ...(input.sourceData ? { sourceData: input.sourceData } : {}),
    capturedAt: input.capturedAt ?? Date.now(),
  };
}
