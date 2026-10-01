export interface AtCoderRawSubmission {
  id: string;
  epochSecond: number;
  contestId: string;
  problemId: string;
  language: string;
  point: number;
  result: string;
  executionTime?: number;
  memory?: number;
}

export interface AtCoderProblem {
  id: string;
  contestId: string;
  problemIndex?: string;
  name?: string;
  title?: string;
}

export interface AtCoderSubmissionDetails {
  memory?: number;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAtCoderSubmissionDetails(
  text: string,
): AtCoderSubmissionDetails {
  const match = text.match(
    /<th[^>]*>\s*Memory\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
  );
  if (!match) return {};
  const value = stripHtml(match[1] ?? "");
  const number = Number(value.replace(/,/g, "").match(/[\d.]+/)?.[0]);
  return Number.isFinite(number) ? { memory: number } : {};
}

export function parseAtCoderSubmissions(text: string): AtCoderRawSubmission[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("AtCoder response is not JSON");
  }
  if (!Array.isArray(value))
    throw new Error("AtCoder response is not an array");
  return value.map((item) => {
    if (!item || typeof item !== "object")
      throw new Error("AtCoder record is not an object");
    const row = item as Record<string, unknown>;
    const id = row.id;
    const epochSecond = row.epoch_second;
    const contestId = row.contest_id;
    const problemId = row.problem_id;
    const language = row.language;
    const point = row.point;
    const result = row.result;
    if (
      typeof id !== "number" ||
      !Number.isFinite(epochSecond) ||
      typeof contestId !== "string" ||
      typeof problemId !== "string" ||
      typeof language !== "string" ||
      typeof point !== "number" ||
      typeof result !== "string"
    ) {
      throw new Error("AtCoder record has invalid fields");
    }
    return {
      id: String(id),
      epochSecond: epochSecond as number,
      contestId,
      problemId,
      language,
      point,
      result,
      executionTime:
        typeof row.execution_time === "number" ? row.execution_time : undefined,
      memory: typeof row.memory === "number" ? row.memory : undefined,
    };
  });
}

export function parseAtCoderProblems(text: string): AtCoderProblem[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("AtCoder problems response is not JSON");
  }
  if (!Array.isArray(value))
    throw new Error("AtCoder problems response is not an array");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.contest_id !== "string")
      return [];
    return [
      {
        id: row.id,
        contestId: row.contest_id,
        ...(typeof row.problem_index === "string"
          ? { problemIndex: row.problem_index }
          : {}),
        ...(typeof row.name === "string" ? { name: row.name } : {}),
        ...(typeof row.title === "string" ? { title: row.title } : {}),
      },
    ];
  });
}
