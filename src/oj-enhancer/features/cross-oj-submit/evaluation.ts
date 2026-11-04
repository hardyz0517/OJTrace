import type { CrossOjEvaluationStatus } from "./model";

const ACCEPTED = new Set(["accepted", "ac"]);
const JUDGING = new Set([
  "in queue",
  "queued",
  "running",
  "judging",
  "queueing",
  "w j",
  "wj",
  "waiting for judging",
  "実行中",
  "採点中",
  "ジャッジ中",
]);
const REJECTED = new Set([
  "wrong answer",
  "wa",
  "time limit exceeded",
  "tle",
  "memory limit exceeded",
  "mle",
  "runtime error",
  "re",
  "compilation error",
  "ce",
  "presentation error",
  "pe",
  "idleness limit exceeded",
  "ole",
  "output limit exceeded",
  "internal error",
  "ie",
  "wrong answer (pe)",
  "不正解",
]);

export function classifyEvaluationText(
  rawText: string,
): CrossOjEvaluationStatus | undefined {
  const text = rawText.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return undefined;
  if (ACCEPTED.has(text)) return "accepted";
  if (
    JUDGING.has(text) ||
    /^running on (?:test|pretest) \d+$/.test(text) ||
    /^\d+\s*\/\s*\d+$/.test(text)
  )
    return "judging";
  const verdict = text.replace(/ on (?:test|pretest) \d+$/, "");
  if (REJECTED.has(verdict)) return "rejected";
  return undefined;
}

export function codeforcesEvaluationFromPage():
  CrossOjEvaluationStatus | undefined {
  const node = document.querySelector<HTMLElement>(
    "#verdict-status-cell, .status-verdict-cell, .verdict-accepted, .verdict-rejected, .verdict-waiting",
  );
  return node
    ? classifyEvaluationText(node.innerText || node.textContent || "")
    : undefined;
}

export function atcoderEvaluationFromPage():
  CrossOjEvaluationStatus | undefined {
  const labeledRow = Array.from(document.querySelectorAll("tr")).find((row) => {
    const label = row
      .querySelector("th, td")
      ?.textContent?.trim()
      .toLowerCase();
    return (
      label === "結果" ||
      label === "verdict" ||
      label === "result" ||
      label === "status"
    );
  });
  const labeledValue = labeledRow?.querySelector("td:last-child")?.textContent;
  return labeledValue ? classifyEvaluationText(labeledValue) : undefined;
}

export async function pollAndReportEvaluation(input: {
  readStatus: () => CrossOjEvaluationStatus | undefined;
  report: (status: CrossOjEvaluationStatus) => Promise<boolean>;
  onReported: (status: CrossOjEvaluationStatus) => void;
  maxPolls?: number;
  intervalMs?: number;
  isCurrentPage?: () => boolean;
}): Promise<CrossOjEvaluationStatus | undefined> {
  const maxPolls = input.maxPolls ?? 30;
  const intervalMs = input.intervalMs ?? 2_000;
  let lastReported: CrossOjEvaluationStatus | undefined;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (input.isCurrentPage?.() === false) return lastReported;
    const status = input.readStatus();
    if (status && status !== lastReported) {
      const saved = await input.report(status).catch(() => false);
      if (!saved) return lastReported;
      if (saved) {
        lastReported = status;
        input.onReported(status);
      }
    }
    if (status === "accepted" || status === "rejected") return status;
    if (attempt + 1 < maxPolls)
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (maxPolls > 0 && !lastReported && input.isCurrentPage?.() !== false) {
    const saved = await input.report("unknown").catch(() => false);
    if (saved) {
      lastReported = "unknown";
      input.onReported("unknown");
    }
  }
  return lastReported;
}
