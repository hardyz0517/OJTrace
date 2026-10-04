import type { CoverageOutcome, SyncCoverage, SyncWindow } from "../../domain";

export type SubmissionWindowPosition =
  "before" | "in-window" | "after" | "invalid";

export function classifySubmittedAt(
  submittedAt: number,
  window: SyncWindow,
): SubmissionWindowPosition {
  if (!Number.isSafeInteger(submittedAt) || submittedAt < 0) return "invalid";
  if (submittedAt < window.since) return "before";
  if (submittedAt > window.until) return "after";
  return "in-window";
}

/** A deadline is an intentional partial collection, distinct from user abort. */
export function isCollectionDeadline(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  const reason: unknown = signal.reason;
  return (
    !!reason &&
    typeof reason === "object" &&
    "kind" in reason &&
    (reason as { kind?: unknown }).kind === "deadline"
  );
}

/** Central constructor keeps partial reasons immutable and duplicate-free. */
export function finalizeCoverage(
  window: SyncWindow,
  pagesFetched: number,
  acceptedRecords: number,
  outcome: CoverageOutcome,
): SyncCoverage {
  let normalizedOutcome = outcome;
  if (outcome.status === "partial") {
    const [first, ...rest] = [...new Set(outcome.reasons)];
    if (!first)
      throw new Error("Partial coverage requires at least one reason");
    normalizedOutcome = {
      status: "partial",
      reasons: Object.freeze([first, ...rest]),
    };
  }
  return {
    window: Object.freeze({ since: window.since, until: window.until }),
    pagesFetched: Math.max(0, Math.floor(pagesFetched)),
    acceptedRecords: Math.max(0, Math.floor(acceptedRecords)),
    outcome: normalizedOutcome,
  };
}
