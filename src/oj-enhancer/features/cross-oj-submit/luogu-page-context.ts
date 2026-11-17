export interface LuoguPageProblemContext {
  problemId: string;
  type?: string;
  atcoderOriginUrl?: string;
  difficulty?: number;
}

const LUOGU_DIFFICULTY_COLORS = {
  0: "grey-3",
  1: "pink-3",
  2: "orange-3",
  3: "gold-3",
  4: "green-3",
  5: "cyan-3",
  6: "blue-3",
  7: "purple-3",
  8: "lapis-4",
} as const;

export type LuoguDifficultyColor =
  (typeof LUOGU_DIFFICULTY_COLORS)[keyof typeof LUOGU_DIFFICULTY_COLORS];

export function normalizeLuoguProblemDifficulty(
  value: unknown,
): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 8
    ? value
    : undefined;
}

export function luoguDifficultyColor(
  value: unknown,
): LuoguDifficultyColor | undefined {
  const difficulty = normalizeLuoguProblemDifficulty(value);
  return difficulty === undefined
    ? undefined
    : LUOGU_DIFFICULTY_COLORS[
        difficulty as keyof typeof LUOGU_DIFFICULTY_COLORS
      ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function contextData(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const data = isRecord(value.data) ? value.data : undefined;
  const currentData = isRecord(value.currentData)
    ? value.currentData
    : undefined;
  return data ?? currentData;
}

/** Parse Luogu's embedded context without depending on the page runtime. */
export function parseLuoguProblemDifficulty(
  value: unknown,
  expectedProblemId?: string,
): number | undefined {
  const data = contextData(value);
  if (!data) return undefined;
  const expected = expectedProblemId?.trim().toUpperCase();
  const candidates: unknown[] = [];
  if (data.problem) candidates.push(data.problem);
  const records = isRecord(data.records) ? data.records.result : undefined;
  if (Array.isArray(records)) {
    for (const item of records) {
      if (isRecord(item) && item.problem) candidates.push(item.problem);
    }
  }
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const pid = typeof candidate.pid === "string" ? candidate.pid.trim() : "";
    if (expected && pid.toUpperCase() !== expected) continue;
    const difficulty = normalizeLuoguProblemDifficulty(candidate.difficulty);
    if (difficulty !== undefined) return difficulty;
  }
  return undefined;
}

export function parseLuoguProblemDifficultyFromHtml(
  html: string,
  expectedProblemId?: string,
): number | undefined {
  const match =
    /<script\b[^>]*\bid=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      html,
    );
  if (!match?.[1]) return undefined;
  try {
    return parseLuoguProblemDifficulty(JSON.parse(match[1]), expectedProblemId);
  } catch {
    return undefined;
  }
}

/** Read the current document's Luogu difficulty metadata, if present. */
export function readLuoguProblemDifficultyInPage(
  expectedProblemId?: string,
): number | undefined {
  const context = document.querySelector<HTMLScriptElement>(
    'script#lentille-context[type="application/json"]',
  );
  if (!context?.textContent) return undefined;
  try {
    return parseLuoguProblemDifficulty(
      JSON.parse(context.textContent),
      expectedProblemId,
    );
  } catch {
    return undefined;
  }
}

/** Read only the public problem identity metadata embedded by Luogu. */
export function readLuoguPageProblemContextInPage():
  LuoguPageProblemContext | undefined {
  const context = document.querySelector<HTMLScriptElement>(
    'script#lentille-context[type="application/json"]',
  );
  if (!context?.textContent) return undefined;
  try {
    const parsed: unknown = JSON.parse(context.textContent);
    if (!parsed || typeof parsed !== "object") return undefined;
    const data = (parsed as { data?: unknown }).data;
    if (!data || typeof data !== "object") return undefined;
    const problem = (data as { problem?: unknown }).problem;
    if (!problem || typeof problem !== "object") return undefined;
    const record = problem as {
      pid?: unknown;
      type?: unknown;
      vjudge?: unknown;
    };
    if (typeof record.pid !== "string" || !record.pid.trim()) return undefined;
    const result: LuoguPageProblemContext = { problemId: record.pid.trim() };
    if (typeof record.type === "string") result.type = record.type;
    // executeScript serializes this function alone, without module helpers.
    const difficulty = (record as { difficulty?: unknown }).difficulty;
    if (
      typeof difficulty === "number" &&
      Number.isInteger(difficulty) &&
      difficulty >= 0 &&
      difficulty <= 8
    )
      result.difficulty = difficulty;
    if (record.vjudge && typeof record.vjudge === "object") {
      const link = (record.vjudge as { link?: unknown }).link;
      if (typeof link === "string") result.atcoderOriginUrl = link;
    }
    return result;
  } catch {
    return undefined;
  }
}
