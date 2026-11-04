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

/** Conservative statement evidence; site UI language is not a content version. */
export function inferProblemLanguage(
  text: string,
): ProblemLanguage | undefined {
  const prose = text.replace(/https?:\/\/\S+/g, "");
  if (/[\u3040-\u30ff]/.test(prose)) return "ja";
  const han = (prose.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (prose.match(/[A-Za-z]/g) ?? []).length;
  if (han >= 2) return han / (han + latin) >= 0.2 ? "zh" : "other";
  if (latin >= 4 && !/[^\p{Script=Latin}\s\d\p{P}\p{S}]/u.test(prose))
    return "en";
  return undefined;
}
