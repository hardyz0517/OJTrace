import { resolveSyncWindow, resolvePaginationPolicy } from "../../domain";
import type {
  AccountRecord,
  AccountSyncProgress,
  CollectionProgress,
  HttpClient,
  StoredData,
} from "../../domain";
import { submissionKey } from "../../domain/merge";
import type { StoragePort } from "../storage/store";
import {
  accountCollectorFor,
  skippedCollection,
  type AccountCollector,
  type SyncSourceResult,
  type AccountCollection,
} from "./collect-account";
import { commitCollections, isCurrentCollection } from "./commit-collection";
export type { SyncSourceResult } from "./collect-account";

export interface SyncResult {
  data: StoredData;
  sources: SyncSourceResult[];
  /** Authoritative terminal status for every account targeted by this request. */
  progress: AccountSyncProgress[];
  /** New submission keys actually retained by this batch's storage transaction. */
  addedRecords: number;
}

function notifyProgress(
  observer: ((progress: AccountSyncProgress) => void) | undefined,
  progress: AccountSyncProgress,
): void {
  try {
    observer?.({ ...progress });
  } catch {
    // Transport/UI failures must never interrupt collection or its commit.
  }
}

function terminalProgress(
  collection: AccountCollection,
  latest: CollectionProgress,
  collector: AccountCollector,
  data?: StoredData,
): AccountSyncProgress {
  const { account, result } = collection;
  const base: AccountSyncProgress = {
    ...latest,
    phase: "done",
    accountId: account.accountId,
    source: account.source,
    status: "partial",
    pagesFetched: result.coverage?.pagesFetched ?? latest.pagesFetched,
    recordsFetched: result.coverage?.acceptedRecords ?? result.records.length,
    diagnostics: result.diagnostics,
  };
  if (!collector.isCurrent(collection)) {
    return { ...base, status: "cancelled", messageKey: "sync.cancelled" };
  }
  if (data && !isCurrentCollection(data, collection)) {
    const active = data.accounts.find(
      (item) => item.accountId === account.accountId,
    );
    return {
      ...base,
      status: "skipped",
      messageKey:
        active && !active.enabled ? "sync.disabled" : "sync.superseded",
    };
  }
  if (result.skipped) {
    return {
      ...base,
      status: result.skipped === "cancelled" ? "cancelled" : "skipped",
      messageKey: `sync.${result.skipped}`,
    };
  }
  if (result.error) {
    return { ...base, status: "failed", messageKey: result.error.messageKey };
  }
  if (result.coverage?.outcome.status === "complete") {
    return { ...base, status: "complete" };
  }
  return {
    ...base,
    status: "partial",
    reasons:
      result.coverage?.outcome.status === "partial"
        ? result.coverage.outcome.reasons
        : ["unverified-coverage"],
  };
}

export async function syncEnabledAccounts(
  storage: StoragePort,
  http: HttpClient,
  options: {
    force: boolean;
    now?: number;
    since?: number;
    until?: number;
    accountIds?: string[];
    recheckActivities?: boolean;
    onProgress?: (progress: AccountSyncProgress) => void;
  } = { force: false },
  collector: AccountCollector = accountCollectorFor(storage, http),
): Promise<SyncResult> {
  const now = options.now ?? Date.now();
  const current = await storage.load();
  const window = resolveSyncWindow({
    now,
    since: options.since,
    until: options.until,
    preference: current.preferences.syncRange,
  });
  const selectedIds = options.accountIds ?? current.preferences.syncAccountIds;
  const accounts = current.accounts.filter(
    (account) =>
      account.enabled &&
      (selectedIds === undefined || selectedIds.includes(account.accountId)),
  );
  const latest = new Map<string, AccountSyncProgress>();
  function publish(
    account: AccountRecord,
    update: Partial<CollectionProgress>,
  ): void {
    const progress: AccountSyncProgress = {
      phase: "queued",
      pagesFetched: 0,
      recordsFetched: 0,
      ...latest.get(account.accountId),
      ...update,
      accountId: account.accountId,
      source: account.source,
      status: "running",
    };
    latest.set(account.accountId, progress);
    notifyProgress(options.onProgress, progress);
  }
  for (const account of accounts) publish(account, {});
  const collections = await Promise.all(
    accounts.map(async (account) => {
      const lastAttemptAt =
        current.syncStates[account.accountId]?.lastAttemptAt;
      const collection =
        !options.force &&
        !options.recheckActivities &&
        lastAttemptAt !== undefined &&
        now - lastAttemptAt < current.preferences.freshnessCooldownMs
          ? skippedCollection(account, window, now, "freshness")
          : await collector.collect({
              account,
              window,
              now,
              onProgress: (update) => publish(account, update),
              recheckActivities: options.recheckActivities,
              paginationPolicy: resolvePaginationPolicy(
                account.source,
                current.preferences.paginationBySource,
              ),
            });
      const settled = terminalProgress(
        collection,
        latest.get(account.accountId)!,
        collector,
      );
      latest.set(account.accountId, settled);
      notifyProgress(options.onProgress, settled);
      return collection;
    }),
  );
  let addedRecords = 0;
  const data = await storage.transact((value) => {
    const previousKeys = new Set(value.submissions.map(submissionKey));
    const committed = commitCollections(
      value,
      collections.filter((item) => collector.isCurrent(item)),
    );
    addedRecords = committed.submissions.filter(
      (record) => !previousKeys.has(submissionKey(record)),
    ).length;
    return committed;
  });
  const progress = collections.map((collection) => {
    const final = terminalProgress(
      collection,
      latest.get(collection.account.accountId)!,
      collector,
      data,
    );
    notifyProgress(options.onProgress, final);
    return final;
  });
  return {
    data,
    progress,
    addedRecords,
    sources: collections
      .filter(
        (item) =>
          isCurrentCollection(data, item) &&
          collector.isCurrent(item) &&
          item.result.skipped !== "superseded" &&
          item.result.skipped !== "cancelled",
      )
      .map((item) => item.result),
  };
}
