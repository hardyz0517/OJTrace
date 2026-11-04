import type { LanguageMatch, LanguageOption } from "./language";

function sourceFamily(
  value: string,
):
  | "cpp20"
  | "cpp23"
  | "python3"
  | "java"
  | "rust"
  | "go"
  | "csharp"
  | undefined {
  const text = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(?:c\+\+|cpp|gnu\+\+)\s*20\b/.test(text)) return "cpp20";
  if (/^(?:c\+\+|cpp|gnu\+\+)\s*23\b/.test(text)) return "cpp23";
  if (/^python\s*3(?:\b|\.)/.test(text)) return "python3";
  if (/^java(?:\s|\d|$)/.test(text)) return "java";
  if (/^rust(?:\s|\d|$)/.test(text)) return "rust";
  if (/^(?:go|golang)(?:\s|\d|$)/.test(text)) return "go";
  if (/^(?:c#|csharp)(?:\s|\d|$)/.test(text)) return "csharp";
  return undefined;
}

function matches(
  family: NonNullable<ReturnType<typeof sourceFamily>>,
  label: string,
): boolean {
  const text = label.toLowerCase();
  switch (family) {
    case "cpp20":
      return /c\+\+.*20|gnu\+\+20/.test(text);
    case "cpp23":
      return /c\+\+.*23|gnu\+\+23/.test(text);
    case "python3":
      return /python.*(?:3\.|3\)|3\s|cpython|pypy)/.test(text);
    case "java":
      return /java/.test(text) && !/javascript/.test(text);
    case "rust":
      return /rust/.test(text);
    case "go":
      return /\bgo\b|golang/.test(text);
    case "csharp":
      return /c#|csharp/.test(text);
  }
}

export function matchAtCoderLanguage(
  sourceLanguage: string,
  options: readonly LanguageOption[],
): LanguageMatch {
  const family = sourceFamily(sourceLanguage);
  if (!family) return { kind: "unsupported" };
  const matching = options.filter((option) => matches(family, option.label));
  if (matching.length === 1) return { kind: "matched", option: matching[0]! };
  if (matching.length > 1) return { kind: "ambiguous", options: matching };
  return { kind: "unsupported" };
}
