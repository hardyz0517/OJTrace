import { isSourceId, type SourceId } from "./types";

export const SECTION_ROLES = [
  "background",
  "description",
  "input",
  "output",
  "samples",
  "sample-input",
  "sample-output",
  "explanation",
  "hint",
] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];
export const MAIN_ROLES = [
  "background",
  "description",
  "input",
  "output",
  "samples",
  "hint",
] as const;
export type MainRole = (typeof MAIN_ROLES)[number];
export const RULE_LANGUAGES = ["zh", "en", "ja"] as const;
export type RuleLanguage = (typeof RULE_LANGUAGES)[number];
export type RuleContext =
  | { kind: "root" }
  | { kind: "any" }
  | { kind: "parent"; role: SectionRole }
  | { kind: "ancestor"; role: SectionRole };
export type HeadingMatcher =
  | { kind: "exact"; text: string }
  | { kind: "numbered"; text: string; required: boolean };
export interface MappingSettings {
  enabled: boolean;
  role: SectionRole;
  contexts: RuleContext[];
}
export interface CustomRule extends MappingSettings {
  id: string;
  matcher: HeadingMatcher;
}
export interface CnoiOptions {
  sectionLevel: number;
  reorder: boolean;
  order: MainRole[];
  unwrapSamples: boolean;
  removeDocumentTitle: boolean;
  addDescriptionHeading: boolean;
  headingMode: "original" | "canonical";
  numbering: "preserve" | "inherit-group";
  sampleTitleMode: "contextual" | "original" | "template";
  labels: Partial<Record<RuleLanguage, Partial<Record<SectionRole, string>>>>;
  sampleTemplates: Partial<
    Record<RuleLanguage, { input: string; output: string }>
  >;
}
export interface CnoiRuleOverrides extends Partial<CnoiOptions> {
  mappings?: Record<string, Partial<MappingSettings>>;
  customRules?: CustomRule[];
}
export interface CnoiRuleEntry {
  defaultsVersion: 1;
  overrides: CnoiRuleOverrides;
}
export interface StoredCnoiRules {
  formatVersion: 1;
  bySource: Partial<Record<SourceId, CnoiRuleEntry>>;
}
export interface RuleIssue {
  path: string;
  message: string;
}
export interface RuleDescriptor extends MappingSettings {
  id: string;
  label: string;
}
export interface CnoiRuleCatalog {
  defaultsVersion: 1;
  options: CnoiOptions;
  rules: RuleDescriptor[];
}

const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));
const keys = (v: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const text = (v: unknown) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= 160 &&
  ![...v].some((c) => c.charCodeAt(0) < 32);
const role = (v: unknown) => SECTION_ROLES.includes(v as SectionRole);
const context = (v: unknown): boolean =>
  record(v) &&
  (((v.kind === "root" || v.kind === "any") && keys(v, ["kind"])) ||
    ((v.kind === "parent" || v.kind === "ancestor") &&
      role(v.role) &&
      keys(v, ["kind", "role"])));
function mapping(v: unknown, partial: boolean): boolean {
  if (!record(v) || !keys(v, ["enabled", "role", "contexts"])) return false;
  return (
    (v.enabled === undefined ? partial : typeof v.enabled === "boolean") &&
    (v.role === undefined ? partial : role(v.role)) &&
    (v.contexts === undefined
      ? partial
      : Array.isArray(v.contexts) &&
        v.contexts.length > 0 &&
        v.contexts.length <= 12 &&
        v.contexts.every(context))
  );
}
export function validateCnoiOverrides(value: unknown): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const fail = (path: string, message: string) =>
    issues.push({ path, message });
  if (!record(value)) return [{ path: "", message: "规则配置必须是对象。" }];
  try {
    if (JSON.stringify(value).length > 64_000)
      return [{ path: "", message: "规则配置过大。" }];
  } catch {
    return [{ path: "", message: "规则配置必须是可序列化的数据。" }];
  }
  const allowed = [
    "sectionLevel",
    "reorder",
    "order",
    "unwrapSamples",
    "removeDocumentTitle",
    "addDescriptionHeading",
    "headingMode",
    "numbering",
    "sampleTitleMode",
    "labels",
    "sampleTemplates",
    "mappings",
    "customRules",
  ];
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(key, "不支持的配置字段。");
  if (
    value.sectionLevel !== undefined &&
    !(
      Number.isInteger(value.sectionLevel) &&
      Number(value.sectionLevel) >= 1 &&
      Number(value.sectionLevel) <= 6
    )
  )
    fail("sectionLevel", "标题层级必须是 1–6 的整数。");
  for (const key of [
    "reorder",
    "unwrapSamples",
    "removeDocumentTitle",
    "addDescriptionHeading",
  ])
    if (value[key] !== undefined && typeof value[key] !== "boolean")
      fail(key, "请选择开关值。");
  if (
    value.order !== undefined &&
    !(
      Array.isArray(value.order) &&
      value.order.length === MAIN_ROLES.length &&
      new Set(value.order).size === MAIN_ROLES.length &&
      value.order.every((v) => MAIN_ROLES.includes(v as MainRole))
    )
  )
    fail("order", "主章节必须完整且不能重复。");
  for (const [key, options] of Object.entries({
    headingMode: ["original", "canonical"],
    numbering: ["preserve", "inherit-group"],
    sampleTitleMode: ["contextual", "original", "template"],
  }))
    if (value[key] !== undefined && !options.includes(String(value[key])))
      fail(key, "不支持的选项。");
  if (value.mappings !== undefined) {
    if (!record(value.mappings) || Object.keys(value.mappings).length > 100)
      fail("mappings", "内置映射配置无效。");
    else
      for (const [id, item] of Object.entries(value.mappings))
        if (!/^[a-z][a-z0-9.-]{1,100}$/u.test(id) || !mapping(item, true))
          fail(`mappings.${id}`, "映射或上下文配置无效。");
  }
  if (value.customRules !== undefined) {
    if (!Array.isArray(value.customRules) || value.customRules.length > 60)
      fail("customRules", "自定义规则最多 60 条。");
    else {
      const ids = new Set<string>();
      value.customRules.forEach((item, i) => {
        const path = `customRules.${i}`;
        if (!record(item)) {
          fail(path, "自定义规则无效。");
          return;
        }
        if (
          !keys(item, ["id", "enabled", "role", "contexts", "matcher"]) ||
          typeof item.id !== "string" ||
          !/^user-[a-z0-9-]{1,80}$/u.test(item.id) ||
          ids.has(item.id)
        )
          fail(path, "自定义规则 ID 无效或重复。");
        ids.add(String(item.id));
        if (
          !mapping(
            { enabled: item.enabled, role: item.role, contexts: item.contexts },
            false,
          )
        )
          fail(path, "请选择目标章节和匹配上下文。");
        const m = item.matcher;
        if (
          !record(m) ||
          !text(m.text) ||
          !(m.kind === "exact"
            ? keys(m, ["kind", "text"])
            : m.kind === "numbered" &&
              keys(m, ["kind", "text", "required"]) &&
              typeof m.required === "boolean" &&
              String(m.text).split("{number}").length === 2)
        )
          fail(
            `${path}.matcher`,
            "完整标题不能为空；编号标题必须包含一个 {number}。",
          );
      });
    }
  }
  for (const key of ["labels", "sampleTemplates"] as const) {
    const data = value[key];
    if (data === undefined) continue;
    if (!record(data) || !keys(data, RULE_LANGUAGES)) {
      fail(key, "只支持中文、英文和日文标题配置。");
      continue;
    }
    for (const [lang, entries] of Object.entries(data)) {
      if (
        !record(entries) ||
        !keys(entries, key === "labels" ? SECTION_ROLES : ["input", "output"])
      ) {
        fail(`${key}.${lang}`, "标题字段无效。");
        continue;
      }
      if (
        key === "sampleTemplates" &&
        (!Object.hasOwn(entries, "input") || !Object.hasOwn(entries, "output"))
      )
        fail(`${key}.${lang}`, "请填写输入与输出模板。");
      for (const [name, title] of Object.entries(entries))
        if (
          !text(title) ||
          (key === "sampleTemplates" &&
            String(title)
              .replaceAll("{number}", "")
              .replaceAll("{numberSuffix}", "")
              .match(/[{}]/u))
        )
          fail(
            `${key}.${lang}.${name}`,
            "标题不能为空；模板只支持 {number} 和 {numberSuffix}。",
          );
    }
  }
  return issues;
}
export const isCnoiOverrides = (v: unknown): v is CnoiRuleOverrides =>
  validateCnoiOverrides(v).length === 0;
export function isCnoiRuleEntry(v: unknown): v is CnoiRuleEntry {
  return (
    record(v) &&
    keys(v, ["defaultsVersion", "overrides"]) &&
    v.defaultsVersion === 1 &&
    isCnoiOverrides(v.overrides)
  );
}
export function isStoredCnoiRules(v: unknown): v is StoredCnoiRules {
  return (
    record(v) &&
    keys(v, ["formatVersion", "bySource"]) &&
    v.formatVersion === 1 &&
    record(v.bySource) &&
    Object.entries(v.bySource).every(
      ([id, entry]) => isSourceId(id) && isCnoiRuleEntry(entry),
    )
  );
}

/** Canonical comparison for per-OJ compare-and-swap and sparse overrides. */
export function canonicalRules(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRules).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalRules(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** UI and persistence use the same sparse representation; no transformation here. */
export function compactOverrides(
  catalog: CnoiRuleCatalog,
  overrides: CnoiRuleOverrides,
): CnoiRuleOverrides {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "mappings") {
      const patches: Record<string, unknown> = {};
      for (const [id, patch] of Object.entries(overrides.mappings ?? {})) {
        const base = catalog.rules.find((r) => r.id === id);
        const fields = Object.fromEntries(
          Object.entries(patch).filter(
            ([k, v]) =>
              !base ||
              canonicalRules(v) !==
                canonicalRules(base[k as keyof typeof base]),
          ),
        );
        if (Object.keys(fields).length) patches[id] = fields;
      }
      if (Object.keys(patches).length) result[key] = patches;
    } else if (key === "labels" || key === "sampleTemplates") {
      const groups: Record<string, unknown> = {};
      for (const [lang, entries] of Object.entries(
        value as Record<string, Record<string, string>>,
      )) {
        const defaults =
          (catalog.options[key] as Record<string, Record<string, string>>)[
            lang
          ] ?? {};
        if (key === "sampleTemplates") {
          if (canonicalRules(entries) !== canonicalRules(defaults))
            groups[lang] = entries;
        } else {
          const fields = Object.fromEntries(
            Object.entries(entries).filter(
              ([name, title]) => title !== defaults[name],
            ),
          );
          if (Object.keys(fields).length) groups[lang] = fields;
        }
      }
      if (Object.keys(groups).length) result[key] = groups;
    } else if (key === "customRules") {
      if (overrides.customRules?.length) result[key] = value;
    } else if (
      canonicalRules(value) !==
      canonicalRules(catalog.options[key as keyof CnoiOptions])
    )
      result[key] = value;
  }
  return result as CnoiRuleOverrides;
}
