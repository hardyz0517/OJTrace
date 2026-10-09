import { AdapterFailure } from "../../domain/errors";
import { submissionKey } from "../../domain/merge";
import { isWithinSyncWindow, type SyncWindow } from "../../domain/sync-range";
import {
  reportProgress,
  type ProgressObserver,
} from "../../domain/sync-progress";
import type { Diagnostic, PartialReason, Submission } from "../../domain";
import { isCollectionDeadline } from "./submission-window";

/** Observe the full site order before window, duplicate or budget filtering. */
export class DescendingWindowTracker {
  private ordered = true;
  private previousOldest = Infinity;

  observe(records: readonly Submission[], since: number) {
    const validTimes = records.every(
      (record) =>
        Number.isSafeInteger(record.submittedAt) && record.submittedAt >= 0,
    );
    this.ordered =
      this.ordered &&
      validTimes &&
      records.every(
        (record, index) =>
          record.submittedAt <=
          (index === 0 ? this.previousOldest : records[index - 1]!.submittedAt),
      );
    if (records.length)
      this.previousOldest = records[records.length - 1]!.submittedAt;
    return {
      validTimes,
      reachedSince:
        this.ordered && records.some((record) => record.submittedAt < since),
    };
  }
}

/** Each collection owns a buffer. First occurrence wins, including overflow. */
export class WindowRecordBuffer {
  readonly records: Submission[] = [];
  private readonly seen = new Set<string>();

  constructor(
    private readonly window: SyncWindow,
    private readonly limit: number,
  ) {}

  append(records: readonly Submission[]): boolean {
    let overflow = false;
    for (const record of records) {
      const key = submissionKey(record);
      if (
        !isWithinSyncWindow(record.submittedAt, this.window) ||
        this.seen.has(key)
      )
        continue;
      this.seen.add(key);
      if (this.records.length < this.limit) this.records.push(record);
      else overflow = true;
    }
    return overflow;
  }
}

/** Signature construction and observation timing belong to the site loop. */
export class PageSignatures {
  private readonly seen = new Set<string>();

  repeated(signature: string): boolean {
    if (!signature) return false;
    if (this.seen.has(signature)) return true;
    this.seen.add(signature);
    return false;
  }
}

export class PageProgress {
  pagesFetched = 0;

  constructor(
    private readonly observer: ProgressObserver | undefined,
    private readonly records: readonly Submission[],
    private readonly estimatesPages = false,
  ) {}

  dispatched(pageEstimate?: number): void {
    this.pagesFetched += 1;
    this.report(pageEstimate);
  }

  report(pageEstimate?: number): void {
    reportProgress(this.observer, {
      phase: "list",
      pagesFetched: this.pagesFetched,
      recordsFetched: this.records.length,
      ...(this.estimatesPages ? { pageEstimate } : {}),
    });
  }
}

/** Luogu/QOJ policy only; deadline precedence deliberately matches both loops. */
export function classifiedPageFailure(
  error: unknown,
  signal: AbortSignal,
  successfulPages: number,
  source: "luogu" | "qoj",
): { reason: PartialReason; diagnostic: Diagnostic } {
  if (signal.aborted && !isCollectionDeadline(signal)) throw signal.reason;
  if (successfulPages > 0 && isCollectionDeadline(signal)) {
    return {
      reason: "deadline",
      diagnostic: {
        source,
        code: "deadline",
        severity: "warning",
        messageKey: "sync.partial",
        retryable: true,
      },
    };
  }
  if (
    successfulPages === 0 ||
    !(error instanceof AdapterFailure) ||
    error.error.stage === "identity" ||
    error.error.kind === "auth_required" ||
    error.error.kind === "unknown"
  )
    throw error;
  const reason: PartialReason = isCollectionDeadline(signal)
    ? "deadline"
    : error.error.kind === "rate_limited"
      ? "rate-limited"
      : "unavailable";
  return {
    reason,
    diagnostic: {
      source,
      code: reason,
      severity: "warning",
      messageKey: error.error.messageKey,
      retryable: error.error.retryable,
    },
  };
}
