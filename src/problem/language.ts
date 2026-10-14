import type { ProblemLanguage } from "./domain";

/** BCP-47 primary subtag used for statement language. Query parameters stay exact elsewhere. */
export function normalizeProblemLanguage(
  value: string | undefined,
): ProblemLanguage | undefined {
  const normalized = value?.trim().toLowerCase().split("-")[0];
  if (!normalized) return undefined;
  if (normalized === "zh" || normalized === "en" || normalized === "ja")
    return normalized;
  return "other";
}
