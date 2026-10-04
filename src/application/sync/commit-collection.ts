import type { StoredData } from "../../domain";
import { mergeSubmissions } from "../../domain/merge";
import { updateBrandingCache } from "../../domain/instance-branding";
import { updateActivityScheduleCache } from "../../domain/activity-schedule";
import { guardCollection, type AccountCollection } from "./collect-account";

export function isCurrentCollection(
  data: StoredData,
  collection: AccountCollection,
): boolean {
  const active = data.accounts.find(
    (item) => item.accountId === collection.account.accountId,
  );
  return Boolean(
    active?.enabled &&
    active.credentialRevision === collection.account.credentialRevision,
  );
}

/** The storage port remains the only writer. Both entry points use this transform. */
export function commitCollections(
  data: StoredData,
  collections: readonly AccountCollection[],
): StoredData {
  const accepted = collections
    .filter((item) => !item.result.skipped && isCurrentCollection(data, item))
    .map(guardCollection);
  if (!accepted.length) return data;
  const syncStates = { ...data.syncStates };
  for (const { account, attemptAt, result } of accepted) {
    const previous = syncStates[account.accountId];
    if (attemptAt < (previous?.lastAttemptAt ?? 0)) continue;
    syncStates[account.accountId] = {
      stale:
        result.coverage?.outcome.status !== "complete" || Boolean(result.error),
      lastAttemptAt: Math.max(attemptAt, previous?.lastAttemptAt ?? 0),
      lastSuccessAt:
        result.coverage?.outcome.status === "complete" && !result.error
          ? Math.max(attemptAt, previous?.lastSuccessAt ?? 0)
          : previous?.lastSuccessAt,
      lastError: result.error,
    };
  }
  return {
    ...data,
    submissions: mergeSubmissions(
      data.submissions,
      accepted.flatMap((item) => item.result.records),
      data.preferences.retentionPerAccount,
    ),
    syncStates,
    activitySchedules: updateActivityScheduleCache(
      data.activitySchedules,
      accepted.flatMap((item) => item.result.activitySchedules ?? []),
    ),
    instanceBranding: updateBrandingCache(
      data.instanceBranding,
      accepted.flatMap((item) =>
        item.result.instanceBranding ? [item.result.instanceBranding] : [],
      ),
    ),
  };
}
