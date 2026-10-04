import type { InstanceBrandingRecord } from "./types";
import { instanceBrandingKey } from "./account-identity";

const MAX_INSTANCES = 32;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;

export function updateBrandingCache(
  current: Record<string, InstanceBrandingRecord>,
  incoming: readonly InstanceBrandingRecord[],
): Record<string, InstanceBrandingRecord> {
  const cache = { ...current };
  for (const item of incoming) {
    const key = instanceBrandingKey(item.source, item.origin, item.domainId);
    const old = cache[key];
    cache[key] = {
      ...old,
      ...item,
      iconDataUrl: item.iconDataUrl ?? old?.iconDataUrl,
      iconFetchedAt: item.iconFetchedAt ?? old?.iconFetchedAt,
    };
  }
  let bytes = 0;
  const retained: Array<[string, InstanceBrandingRecord]> = [];
  for (const entry of Object.entries(cache).sort(
    (a, b) => b[1].fetchedAt - a[1].fetchedAt,
  )) {
    const size = JSON.stringify(entry).length * 2;
    if (retained.length >= MAX_INSTANCES || bytes + size > MAX_CACHE_BYTES)
      continue;
    bytes += size;
    retained.push(entry);
  }
  return Object.fromEntries(retained);
}
