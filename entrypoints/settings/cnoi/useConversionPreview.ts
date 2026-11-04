import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  canonicalRules,
  type CnoiRuleOverrides,
} from "../../../src/domain/cnoi-rules";
import type { SourceId } from "../../../src/domain/types";
import type {
  ProblemMetadata,
  ProblemWarning,
} from "../../../src/problem/domain";
import { sendRulesCommand } from "../../shared/cnoi-rules-client";

interface Preview {
  key: string;
  attempt: number;
  source: SourceId;
  sourceMarkdown: string;
  markdown: string;
  warnings: readonly ProblemWarning[];
}
type Activity = {
  key: string;
  attempt: number;
  version: number;
} & ({ kind: "slow" } | { kind: "error"; message: string });

export function useConversionPreview({
  source,
  markdown,
  metadata,
  draft,
  valid,
  composing,
}: {
  source: SourceId;
  markdown: string;
  metadata: ProblemMetadata;
  draft: CnoiRuleOverrides;
  valid: boolean;
  composing: boolean;
}) {
  const [result, setResult] = useState<Preview | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  // Fixture names/IDs are UI state, not conversion inputs.
  const key = canonicalRules({ source, markdown, metadata, draft });

  // Invalidate responses as soon as new inputs commit, including during IME
  // composition and invalid drafts, before passive-effect cleanup runs.
  useLayoutEffect(() => {
    revision.current++;
    return () => {
      revision.current++;
    };
  }, [key, valid, composing, attempt]);

  useEffect(() => {
    if (!valid || composing) return;
    const version = revision.current;
    let disposed = false;
    let settled = false;
    let slowTimer: number | undefined;
    let timeout: number | undefined;
    const current = () => !disposed && !settled && version === revision.current;
    const finish = () => {
      settled = true;
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeout);
    };
    const fail = (message: string) => {
      if (!current()) return;
      finish();
      setActivity({ key, attempt, version, kind: "error", message });
    };
    const debounce = window.setTimeout(() => {
      // Normal, fast previews don't flash a busy indicator on every keystroke.
      slowTimer = window.setTimeout(() => {
        if (current()) setActivity({ key, attempt, version, kind: "slow" });
      }, 500);
      timeout = window.setTimeout(() => fail("预览转换超时，请重试。"), 15_000);
      void sendRulesCommand({
        type: "PREVIEW_CNOI_CONVERSION",
        source,
        overrides: draft,
        markdown,
        metadata,
      })
        .then((response) => {
          if (!current()) return;
          if (response.type !== "CNOI_PREVIEW") {
            fail("转换服务返回了非预览结果，请重试。");
            return;
          }
          finish();
          setResult({
            key,
            attempt,
            source,
            sourceMarkdown: markdown,
            markdown: response.markdown,
            warnings: response.warnings,
          });
          setActivity(null);
        })
        .catch((error: unknown) => {
          fail(
            error instanceof Error && error.message
              ? error.message
              : "预览失败，请重试。",
          );
        });
    }, 250);
    return () => {
      disposed = true;
      window.clearTimeout(debounce);
      finish();
    };
    // The canonical key covers all conversion inputs. Freshly loaded objects
    // with identical values must not restart a request or revive its feedback.
  }, [key, valid, composing, attempt]);

  // Never present another OJ's result or diagnostics under the new OJ's heading.
  const preview = result?.source === source ? result : null;
  const fresh = Boolean(
    valid && !composing && preview?.key === key && preview.attempt === attempt,
  );
  const currentActivity =
    activity?.key === key &&
    activity.attempt === attempt &&
    activity.version === revision.current
      ? activity
      : null;
  const error =
    valid && !composing && currentActivity?.kind === "error"
      ? currentActivity.message
      : "";
  const state = !valid
    ? "invalid"
    : composing
      ? "composing"
      : error
        ? "error"
        : fresh
          ? "ready"
          : currentActivity?.kind === "slow"
            ? "running"
            : "pending";
  const status = {
    invalid: "请先修正规则配置",
    composing: "输入完成后更新",
    error: "预览失败，可重试",
    ready: "预览已更新",
    running: "正在转换…",
    pending: "预览待更新",
  }[state];
  return {
    preview,
    fresh,
    error,
    state,
    status,
    retry: () => setAttempt((value) => value + 1),
  };
}
