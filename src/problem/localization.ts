import type { ProblemLanguage } from "./domain";

const labels = {
  zh: {
    timeLimit: "时间限制",
    memoryLimit: "内存限制",
    page: {
      prefix: "第 ",
      suffix: " 页",
      totalPrefix: "共 ",
      totalSuffix: " 页",
    },
  },
  en: {
    timeLimit: "Time Limit",
    memoryLimit: "Memory Limit",
    page: { prefix: "Page ", suffix: "", totalPrefix: "", totalSuffix: "" },
  },
  ja: {
    timeLimit: "実行時間制限",
    memoryLimit: "メモリ制限",
    page: {
      prefix: "",
      suffix: " ページ",
      totalPrefix: "全 ",
      totalSuffix: " ページ",
    },
  },
} as const;
export function problemLabels(language?: ProblemLanguage) {
  return language && language !== "other" ? labels[language] : undefined;
}
