import type { StoredData } from "../../domain";
import type { StoragePort } from "../storage/store";

export function updateLuoguSolutionChannelPreference(
  storage: StoragePort,
  enabled: boolean,
): Promise<StoredData> {
  if (typeof enabled !== "boolean")
    return Promise.reject(new RangeError("Invalid Luogu solution-channel preference"));
  return storage.transact((current) => ({
    ...current,
    preferences: {
      ...current.preferences,
      luoguSolutionChannelEnabled: enabled,
    },
  }));
}
