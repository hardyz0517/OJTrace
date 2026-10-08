import {
  isPaginationPolicy,
  isSourceId,
  type PaginationPolicy,
  type SourceId,
  type StoredData,
} from "../../domain";
import type { StoragePort } from "../storage/store";

/** Patch one source through the single writer, preserving concurrent preferences. */
export function updatePaginationPreference(
  storage: StoragePort,
  source: SourceId,
  policy: PaginationPolicy | null,
): Promise<StoredData> {
  if (!isSourceId(source) || (policy !== null && !isPaginationPolicy(policy)))
    return Promise.reject(new RangeError("Invalid pagination preference"));
  const snapshot =
    policy === null
      ? null
      : { intervalMs: policy.intervalMs, jitterMs: policy.jitterMs };
  return storage.transact((current) => {
    const paginationBySource = { ...current.preferences.paginationBySource };
    if (snapshot === null) delete paginationBySource[source];
    else paginationBySource[source] = snapshot;
    const preferences = { ...current.preferences };
    if (Object.keys(paginationBySource).length)
      preferences.paginationBySource = paginationBySource;
    else delete preferences.paginationBySource;
    return { ...current, preferences };
  });
}
