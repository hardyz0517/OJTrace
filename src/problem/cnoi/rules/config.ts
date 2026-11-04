import type { SourceId } from "../../../domain/types";
import {
  MAIN_ROLES,
  compactOverrides,
  validateCnoiOverrides,
  type CnoiOptions,
  type CnoiRuleOverrides,
  type CnoiRuleCatalog,
  type RuleDescriptor,
  type RuleIssue,
  type SectionRole,
  type RuleContext,
  type HeadingMatcher,
} from "../../../domain/cnoi-rules";
import { commonRules, sectionTitles, type BuiltinAliases } from "./common";
import { luoguRules } from "./luogu";
import { codeforcesRules } from "./codeforces";
import { atcoderRules } from "./atcoder";
import { qojRules } from "./qoj";
import { hydrojRules } from "./hydroj";

export interface ResolvedMapping extends RuleDescriptor {
  pattern?: string;
  matcher?: HeadingMatcher;
  priority: number;
  group?: boolean;
}
export interface ResolvedCnoiRules extends CnoiOptions {
  mappings: ResolvedMapping[];
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
const formatContexts: RuleContext[] = [
  { kind: "root" },
  { kind: "parent", role: "description" },
];
const sampleContexts: RuleContext[] = [
  ...formatContexts,
  { kind: "parent", role: "samples" },
];
const siteAliases: Record<SourceId, BuiltinAliases> = {
  luogu: luoguRules,
  codeforces: codeforcesRules,
  atcoder: atcoderRules,
  qoj: qojRules,
  hydroj: hydrojRules,
};
const labels: Record<SectionRole, string> = {
  background: "题目背景 / Background",
  description: "题目描述 / Problem Statement / 問題文",
  input: "输入 / Input / 入力",
  output: "输出 / Output / 出力",
  samples: "样例 / Examples / Samples",
  "sample-input": "样例输入 / Sample Input / 入力例",
  "sample-output": "样例输出 / Sample Output / 出力例",
  explanation: "样例说明 / Explanation / 解説",
  hint: "提示 / Notes",
};
const siteLabels: Record<string, Partial<Record<SectionRole, string>>> = {
  luogu: {
    input: "formatI / inputFormat",
    output: "formatO / outputFormat",
    samples: "输入输出样例 / 输入输出示例 / 入出力例（可带 #编号）",
    hint: "提示说明",
  },
  codeforces: { samples: "Example Test / Example Tests", hint: "Note" },
  atcoder: {
    input: "入力形式",
    output: "出力形式",
    explanation: "入力例 / 出力例 + 编号 + の説明 / の解説",
  },
  qoj: {
    input: "Input Specification",
    output: "Output Specification",
    samples:
      "Sample Tests / Sample Cases / Example Tests / 样例测试 / 样例数据",
    hint: "Sample Notes / 备注",
  },
  hydroj: {
    input: "输入说明",
    output: "输出说明",
    samples: "输入输出示例 / 测试样例 / Sample Cases",
    hint: "样例解释与提示 / 提示与说明",
  },
};
function definitions(scope: string, data: BuiltinAliases): ResolvedMapping[] {
  return Object.entries(data.aliases).flatMap(([key, patterns]) => {
    const role = key as SectionRole;
    return patterns!.map((pattern, index) => ({
      id: `${scope}.${role}${index ? `-${index + 1}` : ""}`,
      label:
        scope === "common"
          ? labels[role]
          : (siteLabels[scope]?.[role] ?? labels[role]),
      enabled: true,
      role,
      pattern,
      contexts:
        role.startsWith("sample-") || role === "explanation"
          ? [{ kind: "any" } as const]
          : role === "samples"
            ? sampleContexts
            : formatContexts,
      priority: role.startsWith("sample-")
        ? 50
        : role === "samples"
          ? 40
          : role === "explanation"
            ? 20
            : 10,
    }));
  });
}
function defaultRules(source: SourceId): ResolvedCnoiRules {
  return {
    sectionLevel: 2,
    reorder: true,
    order: [...MAIN_ROLES],
    unwrapSamples: true,
    removeDocumentTitle: true,
    addDescriptionHeading: true,
    headingMode: "original",
    numbering: "preserve",
    sampleTitleMode: "contextual",
    labels: structuredClone(sectionTitles),
    sampleTemplates: Object.fromEntries(
      Object.entries(sectionTitles).map(([lang, titles]) => [
        lang,
        {
          input: `${titles["sample-input"]}{numberSuffix}`,
          output: `${titles["sample-output"]}{numberSuffix}`,
        },
      ]),
    ),
    mappings: [
      ...definitions("common", commonRules),
      ...definitions(source, siteAliases[source]),
      ...(["input", "output"] as const).map((key) => ({
        id: `context.sample-${key}`,
        label: `样例章节内的 ${key === "input" ? "Input / 输入 / 入力" : "Output / 输出 / 出力"}`,
        enabled: true,
        role: `sample-${key}` as SectionRole,
        contexts: [{ kind: "parent" as const, role: "samples" as const }],
        pattern:
          key === "input"
            ? "^(?:input|输入|入力)(?:\\s*#?\\s*[0-9A-Za-z一二三四五六七八九十]+)?$"
            : "^(?:output|输出|出力)(?:\\s*#?\\s*[0-9A-Za-z一二三四五六七八九十]+)?$",
        priority: 30,
      })),
      {
        id: "common.numbered-group",
        label: "带编号的 Example / Sample / 样例组（保留组标题）",
        enabled: true,
        role: "samples",
        contexts: [{ kind: "any" }],
        pattern:
          "^(?:examples?|samples?|样例|示例)\\s*#?\\s*(?:[0-9]+|[A-Za-z]|[IVXLCDM]+|[一二三四五六七八九十]+)$",
        priority: 5,
        group: true,
      },
    ],
  };
}
export const ojRules = deepFreeze(
  Object.fromEntries(
    Object.keys(siteAliases).map((source) => [
      source,
      defaultRules(source as SourceId),
    ]),
  ) as Record<SourceId, ResolvedCnoiRules>,
);
export function ruleCatalog(source: SourceId): CnoiRuleCatalog {
  const { mappings, ...options } = ojRules[source];
  return structuredClone({
    defaultsVersion: 1,
    options,
    rules: mappings.map(({ id, label, enabled, role, contexts }) => ({
      id,
      label,
      enabled,
      role,
      contexts,
    })),
  });
}
export function validateRules(
  source: SourceId,
  overrides: unknown,
): RuleIssue[] {
  const issues = validateCnoiOverrides(overrides);
  if (issues.length) return issues;
  for (const id of Object.keys((overrides as CnoiRuleOverrides).mappings ?? {}))
    if (!ojRules[source].mappings.some((rule) => rule.id === id))
      issues.push({
        path: `mappings.${id}`,
        message: "内置规则不存在或不属于当前 OJ，请恢复该项默认值。",
      });
  return issues;
}
export function resolveRules(
  source: SourceId,
  overrides: CnoiRuleOverrides = {},
): ResolvedCnoiRules {
  const issues = validateRules(source, overrides);
  if (issues.length)
    throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
  const {
    mappings: patches,
    customRules,
    ...options
  } = compactOverrides(ruleCatalog(source), overrides);
  return {
    ...structuredClone(ojRules[source]),
    ...structuredClone(options),
    labels: Object.fromEntries(
      Object.entries(ojRules[source].labels).map(([lang, base]) => [
        lang,
        { ...base, ...options.labels?.[lang as keyof typeof options.labels] },
      ]),
    ),
    sampleTemplates: {
      ...structuredClone(ojRules[source].sampleTemplates),
      ...options.sampleTemplates,
    },
    mappings: [
      ...ojRules[source].mappings.map((rule) => ({
        ...structuredClone(rule),
        ...structuredClone(patches?.[rule.id] ?? {}),
        priority:
          patches?.[rule.id]?.role !== undefined ||
          patches?.[rule.id]?.contexts !== undefined
            ? 80
            : rule.priority,
      })),
      ...(customRules ?? []).map((rule) => ({
        ...structuredClone(rule),
        label: rule.matcher.text,
        priority: 100,
      })),
    ],
  };
}
export function minimizeOverrides(
  source: SourceId,
  overrides: CnoiRuleOverrides,
): CnoiRuleOverrides {
  resolveRules(source, overrides);
  return structuredClone(compactOverrides(ruleCatalog(source), overrides));
}

const normalized = (v: string) =>
  v.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
export function matchesTitle(rule: ResolvedMapping, title: string): boolean {
  if (rule.pattern) return new RegExp(rule.pattern, "iu").test(title);
  const matcher = rule.matcher!;
  if (matcher.kind === "exact")
    return normalized(title) === normalized(matcher.text);
  return matchedHeadingNumber(matcher, title) !== null;
}
/** null means no match; an empty string is a matched optional missing number. */
export function matchedHeadingNumber(
  matcher: HeadingMatcher,
  title: string,
): string | null {
  if (matcher.kind !== "numbered") return null;
  const [before = "", after = ""] = normalized(matcher.text).split("{number}");
  const raw = title.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const input = raw.toLowerCase();
  if (!matcher.required && input === normalized(before + after)) return "";
  if (!input.startsWith(before) || !input.endsWith(after)) return null;
  const middle = raw
    .slice(before.length, after.length ? -after.length : undefined)
    .trim();
  return /^#?\s*[0-9a-z一二三四五六七八九十]+$/iu.test(middle)
    ? middle.replace(/^#\s*/u, "")
    : null;
}

/** Unknown headings and explanations are ancestry barriers by default. */
export function matchContext(
  contexts: RuleContext[],
  ancestors: (SectionRole | undefined)[],
): boolean {
  return contexts.some(
    (c) =>
      c.kind === "any" ||
      (c.kind === "root" && !ancestors.length) ||
      (c.kind === "parent" && ancestors.at(-1) === c.role) ||
      (c.kind === "ancestor" &&
        (() => {
          for (const role of [...ancestors].reverse()) {
            if (role === c.role) return true;
            if (!role || role === "explanation") return false;
          }
          return false;
        })()),
  );
}
