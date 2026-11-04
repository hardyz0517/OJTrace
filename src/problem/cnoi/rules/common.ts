import type { ProblemLanguage } from "../../domain";

import type { SectionRole } from "../../../domain/cnoi-rules";
export interface BuiltinAliases {
  readonly aliases: Readonly<Partial<Record<SectionRole, readonly string[]>>>;
}

/** Serializable rule data; no browser state or executable user scripts. */
export const commonRules: BuiltinAliases = {
  aliases: {
    background: ["^(?:题目背景|背景|background)$"],
    description: [
      "^(?:题目描述|题目大意|problem statement|description|statement|問題文)$",
    ],
    input: ["^(?:输入格式|输入|inputs?(?: format| data)?|入力)$"],
    output: ["^(?:输出格式|输出|outputs?(?: format| data)?|出力)$"],
    samples: ["^(?:samples?|examples?|输入输出样例|样例|示例)$"],
    "sample-input": [
      "^(?:(?:sample|example)\\s*input|(?:样例|示例)\\s*(?:[0-9A-Za-z一二三四五六七八九十]+\\s*)?输入|输入样例|入力例)(?:\\s*#?\\s*[0-9A-Za-z一二三四五六七八九十]+)?$",
    ],
    "sample-output": [
      "^(?:(?:sample|example)\\s*output|(?:样例|示例)\\s*(?:[0-9A-Za-z一二三四五六七八九十]+\\s*)?输出|输出样例|出力例)(?:\\s*#?\\s*[0-9A-Za-z一二三四五六七八九十]+)?$",
    ],
    explanation: [
      "^(?:(?:sample|example|样例|示例)\\s*)?(?:explanation|解释|说明|解説)(?:\\s*#?\\s*[0-9A-Za-z一二三四五六七八九十]+)?$",
    ],
    hint: ["^(?:说明[/／]提示|提示|notes?|hints?)$"],
  },
};

export const sectionTitles = {
  zh: {
    background: "题目背景",
    description: "题目描述",
    input: "输入格式",
    output: "输出格式",
    hint: "说明/提示",
    samples: "样例",
    explanation: "样例说明",
    "sample-input": "样例输入",
    "sample-output": "样例输出",
  },
  en: {
    background: "Background",
    description: "Problem Statement",
    input: "Input",
    output: "Output",
    hint: "Notes",
    samples: "Samples",
    explanation: "Explanation",
    "sample-input": "Sample Input",
    "sample-output": "Sample Output",
  },
  ja: {
    background: "背景",
    description: "問題文",
    input: "入力",
    output: "出力",
    hint: "解説",
    samples: "入出力例",
    explanation: "解説",
    "sample-input": "入力例",
    "sample-output": "出力例",
  },
} as const;

export function sectionTitle(
  language: ProblemLanguage | undefined,
  role: keyof typeof sectionTitles.en,
): string | undefined {
  return language && language !== "other"
    ? sectionTitles[language][role]
    : undefined;
}
