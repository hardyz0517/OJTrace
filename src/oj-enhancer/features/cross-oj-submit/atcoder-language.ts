import type { LanguageOption } from "./language";

export function findAtCoderCpp23Language(
  options: readonly LanguageOption[],
): LanguageOption | undefined {
  return options.find((option) =>
    /(?:^|[^a-z0-9])(?:c\+\+|gnu\+\+)\s*23\b/i.test(option.label),
  );
}
