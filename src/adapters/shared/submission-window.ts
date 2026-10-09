import type { SyncWindow } from "../../domain";

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
