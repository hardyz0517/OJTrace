import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  canonicalRules,
  compactOverrides,
  validateCnoiOverrides,
  type CnoiRuleOverrides,
  type RuleIssue,
} from "../../../src/domain/cnoi-rules";
import type { SourceId } from "../../../src/domain/types";
import type { RulesState } from "../../../src/application/cnoi-rules/messages";
import {
  sendRulesCommand,
  RulesClientError,
} from "../../shared/cnoi-rules-client";
import { previewFixtures, type PreviewFixture } from "./fixtures";

export interface RuleSession {
  state: RulesState;
  draft: CnoiRuleOverrides;
  fixture: PreviewFixture;
  custom?: PreviewFixture;
  external: boolean;
  errors: RuleIssue[];
}
type Sessions = Partial<Record<SourceId, RuleSession>>;
type Action = {
  source: SourceId;
  update: (session: RuleSession | undefined) => RuleSession;
};
export function dirty(session: RuleSession) {
  return (
    canonicalRules(compactOverrides(session.state.catalog, session.draft)) !==
    canonicalRules(session.state.entry?.overrides ?? {})
  );
}
export function useRulesWorkspace() {
  const [source, setSource] = useState<SourceId>("luogu");
  const [sessions, dispatch] = useReducer(
    (state: Sessions, action: Action) => ({
      ...state,
      [action.source]: action.update(state[action.source]),
    }),
    {},
  );
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const loadSequences = useRef<Partial<Record<SourceId, number>>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const update = useCallback(
    (source: SourceId, change: (s: RuleSession) => RuleSession) =>
      dispatch({ source, update: (s) => change(s!) }),
    [],
  );
  const load = useCallback(async (source: SourceId, rebase = false) => {
    const sequence = (loadSequences.current[source] ?? 0) + 1;
    loadSequences.current[source] = sequence;
    try {
      const response = await sendRulesCommand({
        type: "GET_CNOI_RULES",
        source,
      });
      if (
        response.type !== "CNOI_RULES" ||
        sequence !== loadSequences.current[source]
      )
        return;
      dispatch({
        source,
        update: (previous) => {
          if (!previous)
            return {
              state: response.state,
              draft: response.state.entry?.overrides ?? {},
              fixture: previewFixtures[source][0]!,
              external: false,
              errors: [],
            };
          if (rebase || !dirty(previous))
            return {
              ...previous,
              state: response.state,
              draft: rebase
                ? previous.draft
                : (response.state.entry?.overrides ?? {}),
              external: false,
              errors: [],
            };
          return {
            ...previous,
            external:
              canonicalRules(previous.state.entry) !==
              canonicalRules(response.state.entry),
          };
        },
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取规则失败。");
    }
  }, []);
  useEffect(() => {
    if (!sessionsRef.current[source]) void load(source);
  }, [source, load]);
  useEffect(() => {
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && Object.hasOwn(changes, "ojtrace:data"))
        for (const key of Object.keys(sessionsRef.current))
          void load(key as SourceId);
    };
    browser.storage.onChanged.addListener(changed);
    return () => browser.storage.onChanged.removeListener(changed);
  }, [load]);
  const hasDirty = Object.values(sessions).some(dirty);
  function edit(patch: Partial<CnoiRuleOverrides>) {
    update(source, (s) => ({
      ...s,
      draft: { ...s.draft, ...patch },
      errors: [],
    }));
    setMessage("");
  }
  async function save() {
    const session = sessionsRef.current[source];
    if (!session || saving) return;
    const errors = validateCnoiOverrides(session.draft);
    if (errors.length) {
      update(source, (s) => ({ ...s, errors }));
      return;
    }
    const submitted = structuredClone(session.draft);
    const savingSource = source;
    loadSequences.current[savingSource] =
      (loadSequences.current[savingSource] ?? 0) + 1;
    setSaving(true);
    setMessage("");
    try {
      const response = await sendRulesCommand({
        type: "UPDATE_CNOI_RULES",
        source: savingSource,
        overrides: submitted,
        expected: session.state.entry,
      });
      if (response.type !== "CNOI_RULES") return;
      loadSequences.current[savingSource] =
        (loadSequences.current[savingSource] ?? 0) + 1;
      update(savingSource, (s) => ({
        ...s,
        state: response.state,
        draft:
          canonicalRules(s.draft) === canonicalRules(submitted)
            ? (response.state.entry?.overrides ?? {})
            : s.draft,
        errors: [],
        external: false,
      }));
      setMessage("规则已保存，从新发起的转换任务生效。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
      if (error instanceof RulesClientError)
        update(savingSource, (s) => ({ ...s, errors: error.issues }));
    } finally {
      setSaving(false);
    }
  }
  return {
    source,
    setSource,
    session: sessions[source],
    sessions,
    update,
    edit,
    load,
    save,
    saving,
    hasDirty,
    message,
    setMessage,
  };
}
