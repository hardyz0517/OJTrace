import type { CrossOjLanguageOption } from "./model";

export type LanguageOption = CrossOjLanguageOption;

export type LanguageMatch =
  | { kind: "matched"; option: LanguageOption }
  | { kind: "ambiguous"; options: LanguageOption[] }
  | { kind: "unsupported" };

type LanguageKey =
  | "cpp14"
  | "cpp17"
  | "cpp20"
  | "cpp23"
  | "python3"
  | "java"
  | "csharp"
  | "kotlin"
  | "rust"
  | "go";

function sourceKey(raw: string): LanguageKey | undefined {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(?:c\+\+|cpp|g\+\+|gnu\+\+)\s*14\b/.test(text)) return "cpp14";
  if (/^(?:c\+\+|cpp|g\+\+|gnu\+\+)\s*17\b/.test(text)) return "cpp17";
  if (/^(?:c\+\+|cpp|g\+\+|gnu\+\+)\s*20\b/.test(text)) return "cpp20";
  if (/^(?:c\+\+|cpp|g\+\+|gnu\+\+)\s*23\b/.test(text)) return "cpp23";
  if (/^(?:python\s*3|python3)(?:\b|\.)/.test(text)) return "python3";
  if (/^(?:java)(?:\s|\d|$)/.test(text)) return "java";
  if (/^(?:c#|csharp|c sharp)(?:\s|\d|$)/.test(text)) return "csharp";
  if (/^(?:kotlin)(?:\s|\d|$)/.test(text)) return "kotlin";
  if (/^(?:rust)(?:\s|\d|$)/.test(text)) return "rust";
  if (/^(?:go|golang)(?:\s|\d|$)/.test(text)) return "go";
  return undefined;
}

function optionMatches(key: LanguageKey, label: string): boolean {
  const text = label.toLowerCase();
  switch (key) {
    case "cpp14":
      return /(?:gnu|g\+\+|c\+\+|cpp).*(?:14|1\.4)|(?:14|1\.4).*(?:gnu|g\+\+|c\+\+|cpp)/.test(
        text,
      );
    case "cpp17":
      return /(?:gnu|g\+\+|c\+\+|cpp).*(?:17|1\.7)|(?:17|1\.7).*(?:gnu|g\+\+|c\+\+|cpp)/.test(
        text,
      );
    case "cpp20":
      return /(?:gnu|g\+\+|c\+\+|cpp).*(?:20|2\.0)|(?:20|2\.0).*(?:gnu|g\+\+|c\+\+|cpp)/.test(
        text,
      );
    case "cpp23":
      return /(?:gnu|g\+\+|c\+\+|cpp).*(?:23|2\.3)|(?:23|2\.3).*(?:gnu|g\+\+|c\+\+|cpp)/.test(
        text,
      );
    case "python3":
      return (
        /python\s*3|python3/.test(text) && !/python\s*2|python2/.test(text)
      );
    case "java":
      return /java/.test(text) && !/javascript/.test(text);
    case "csharp":
      return /c#|csharp|c sharp/.test(text);
    case "kotlin":
      return /kotlin/.test(text);
    case "rust":
      return /rust/.test(text);
    case "go":
      return /\bgo\b|golang/.test(text);
  }
}

export function matchCodeforcesLanguage(
  luoguLanguage: string,
  options: readonly LanguageOption[],
): LanguageMatch {
  const key = sourceKey(luoguLanguage);
  if (!key) return { kind: "unsupported" };
  const matching = options.filter((option) => optionMatches(key, option.label));
  if (matching.length === 1) return { kind: "matched", option: matching[0]! };
  if (matching.length > 1) return { kind: "ambiguous", options: [...matching] };
  return { kind: "unsupported" };
}
