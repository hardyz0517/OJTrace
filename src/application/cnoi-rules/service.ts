import type { StoragePort } from "../storage/store";
import {
  canonicalRules,
  type CnoiRuleOverrides,
  type CnoiRuleEntry,
  type RuleIssue,
} from "../../domain/cnoi-rules";
import type { SourceId } from "../../domain/types";
import {
  minimizeOverrides,
  ruleCatalog,
  validateRules,
} from "../../problem/cnoi/rules/config";
import { convertSourceToCnoi } from "../../problem/cnoi/convert";
import type { RulesMessage, RulesResponse, RulesState } from "./messages";

export async function readRulesState(
  storage: StoragePort,
  source: SourceId,
): Promise<RulesState> {
  const data = await storage.load();
  const entry = data.preferences.cnoiRules?.bySource[source] ?? null;
  return {
    source,
    catalog: ruleCatalog(source),
    entry,
    issues: [
      ...(entry ? validateRules(source, entry.overrides) : []),
      ...(data.preferences.cnoiRuleProblems?.[source]
        ? [{ path: "", message: data.preferences.cnoiRuleProblems[source]! }]
        : []),
    ],
  };
}
export class RulesValidationError extends Error {
  constructor(readonly issues: RuleIssue[]) {
    super("规则配置有误，请修正后再保存。");
  }
}
export async function saveRules(
  storage: StoragePort,
  source: SourceId,
  overrides: CnoiRuleOverrides,
  expected: CnoiRuleEntry | null,
): Promise<RulesState> {
  const issues = validateRules(source, overrides);
  if (issues.length) throw new RulesValidationError(issues);
  const patch = minimizeOverrides(source, overrides);
  const next: CnoiRuleEntry | null = Object.keys(patch).length
    ? { defaultsVersion: 1, overrides: patch }
    : null;
  await storage.transact((current) => {
    const previous = current.preferences.cnoiRules?.bySource[source] ?? null;
    if (
      canonicalRules(previous) !== canonicalRules(expected) &&
      canonicalRules(previous) !== canonicalRules(next)
    )
      throw new Error(
        "此 OJ 的规则已在其他页面修改。请重新读取后再保存，当前草稿仍保留。",
      );
    const bySource = { ...current.preferences.cnoiRules?.bySource };
    if (next) bySource[source] = next;
    else delete bySource[source];
    const preferences = { ...current.preferences };
    if (Object.keys(bySource).length)
      preferences.cnoiRules = { formatVersion: 1, bySource };
    else delete preferences.cnoiRules;
    const problems = { ...preferences.cnoiRuleProblems };
    delete problems[source];
    if (Object.keys(problems).length) preferences.cnoiRuleProblems = problems;
    else delete preferences.cnoiRuleProblems;
    return { ...current, preferences };
  });
  return readRulesState(storage, source);
}
export async function handleRulesMessage(
  storage: StoragePort,
  message: RulesMessage,
): Promise<RulesResponse> {
  const envelope = { schemaVersion: 1 as const, requestId: message.requestId };
  try {
    if (message.type === "GET_CNOI_RULES")
      return {
        ...envelope,
        ok: true,
        type: "CNOI_RULES",
        state: await readRulesState(storage, message.source),
      };
    if (message.type === "UPDATE_CNOI_RULES")
      return {
        ...envelope,
        ok: true,
        type: "CNOI_RULES",
        state: await saveRules(
          storage,
          message.source,
          message.overrides,
          message.expected,
        ),
      };
    const issues = validateRules(message.source, message.overrides);
    if (issues.length) throw new RulesValidationError(issues);
    const result = convertSourceToCnoi(
      {
        sourceMarkdown: message.markdown,
        metadata: message.metadata,
        assets: [],
        warnings: [],
      },
      message.overrides,
    );
    return result.ok
      ? {
          ...envelope,
          ok: true,
          type: "CNOI_PREVIEW",
          markdown: result.value.cnoiMarkdown,
          warnings: result.value.warnings,
        }
      : { ...envelope, ok: false, error: result.message };
  } catch (error) {
    return {
      ...envelope,
      ok: false,
      error: error instanceof Error ? error.message : "规则操作失败，请重试。",
      ...(error instanceof RulesValidationError
        ? { issues: error.issues }
        : {}),
    };
  }
}
