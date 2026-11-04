import { isSourceId, type SourceId } from "../../domain/types";
import {
  isCnoiOverrides,
  isCnoiRuleEntry,
  validateCnoiOverrides,
  type CnoiRuleOverrides,
  type CnoiRuleEntry,
  type CnoiRuleCatalog,
  type RuleIssue,
} from "../../domain/cnoi-rules";
import type { ProblemMetadata, ProblemWarning } from "../../problem/domain";
import { PROBLEM_MARKDOWN_LIMIT } from "../../problem/budget";

export type RulesCommand =
  | { type: "GET_CNOI_RULES"; source: SourceId }
  | {
      type: "UPDATE_CNOI_RULES";
      source: SourceId;
      overrides: CnoiRuleOverrides;
      expected: CnoiRuleEntry | null;
    }
  | {
      type: "PREVIEW_CNOI_CONVERSION";
      source: SourceId;
      overrides: CnoiRuleOverrides;
      markdown: string;
      metadata: ProblemMetadata;
    };
export type RulesMessage = RulesCommand & {
  schemaVersion: 1;
  requestId: string;
};
export interface RulesState {
  source: SourceId;
  catalog: CnoiRuleCatalog;
  entry: CnoiRuleEntry | null;
  issues: RuleIssue[];
}
export type RulesPayload =
  | { type: "CNOI_RULES"; state: RulesState }
  | {
      type: "CNOI_PREVIEW";
      markdown: string;
      warnings: readonly ProblemWarning[];
    };
export type RulesResponse = (
  | ({ ok: true } & RulesPayload)
  | { ok: false; error: string; issues?: RuleIssue[] }
) & { schemaVersion: 1; requestId: string };
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));
export function isRulesMessage(v: unknown): v is RulesMessage {
  if (
    !record(v) ||
    v.schemaVersion !== 1 ||
    typeof v.requestId !== "string" ||
    !v.requestId ||
    !isSourceId(v.source)
  )
    return false;
  if (v.type === "GET_CNOI_RULES") return true;
  if (!isCnoiOverrides(v.overrides)) return false;
  if (v.type === "UPDATE_CNOI_RULES")
    return v.expected === null || isCnoiRuleEntry(v.expected);
  if (
    v.type !== "PREVIEW_CNOI_CONVERSION" ||
    typeof v.markdown !== "string" ||
    v.markdown.length > PROBLEM_MARKDOWN_LIMIT ||
    !record(v.metadata)
  )
    return false;
  const m = v.metadata;
  return (
    m.oj === v.source &&
    ["title", "problemId", "originalUrl"].every(
      (k) => typeof m[k] === "string" && String(m[k]).length <= 2000,
    ) &&
    ["zh", "en", "ja", "other"].includes(String(m.language)) &&
    /^https?:\/\//u.test(String(m.originalUrl))
  );
}
export function isRulesResponse(v: unknown): v is RulesResponse {
  if (!record(v) || v.schemaVersion !== 1 || typeof v.requestId !== "string")
    return false;
  if (v.ok === false)
    return (
      typeof v.error === "string" &&
      (v.issues === undefined ||
        (Array.isArray(v.issues) &&
          v.issues.every(
            (i) =>
              record(i) &&
              typeof i.path === "string" &&
              typeof i.message === "string",
          )))
    );
  if (v.ok !== true) return false;
  if (v.type === "CNOI_PREVIEW")
    return (
      typeof v.markdown === "string" &&
      v.markdown.length <= PROBLEM_MARKDOWN_LIMIT &&
      Array.isArray(v.warnings) &&
      v.warnings.every(
        (w) =>
          record(w) &&
          typeof w.code === "string" &&
          typeof w.message === "string",
      )
    );
  if (v.type !== "CNOI_RULES" || !record(v.state)) return false;
  const s = v.state,
    c = s.catalog;
  return (
    isSourceId(s.source) &&
    (s.entry === null || isCnoiRuleEntry(s.entry)) &&
    Array.isArray(s.issues) &&
    record(c) &&
    c.defaultsVersion === 1 &&
    validateCnoiOverrides(c.options).length === 0 &&
    Array.isArray(c.rules) &&
    c.rules.every(
      (r) =>
        record(r) &&
        typeof r.id === "string" &&
        typeof r.label === "string" &&
        validateCnoiOverrides({
          mappings: {
            [r.id]: { enabled: r.enabled, role: r.role, contexts: r.contexts },
          },
        }).length === 0,
    )
  );
}
