import type { SourceId, Diagnostic } from "./types";
import type { PartialReason } from "./adapter";

export type SyncPhase =
  | "queued"
  | "identity"
  | "list"
  | "activities"
  | "details"
  | "branding"
  | "done";
export interface CollectionProgress {
  phase: SyncPhase;
  pagesFetched: number;
  recordsFetched: number;
  /** A scan estimate, never an exact denominator for the selected window. */
  pageEstimate?: number;
  activitiesCompleted?: number;
  activitiesTotal?: number;
  detailsCompleted?: number;
  detailsTotal?: number;
}
export type ProgressObserver = (update: Partial<CollectionProgress>) => void;
export type AccountProgressStatus =
  "running" | "complete" | "partial" | "failed" | "skipped" | "cancelled";
export interface AccountSyncProgress extends CollectionProgress {
  accountId: string;
  source: SourceId;
  status: AccountProgressStatus;
  messageKey?: string;
  reasons?: readonly PartialReason[];
  diagnostics?: readonly Diagnostic[];
}

/** Progress is observational: a disconnected UI must never fail collection. */
export function reportProgress(
  observer: ProgressObserver | undefined,
  update: Partial<CollectionProgress>,
): void {
  try {
    observer?.(update);
  } catch {
    /* Collection does not depend on the observer. */
  }
}
