import type { StorageAreaLike } from "../../src/application/storage/store";

/** Browser storage test double; production migrations and transactions stay real. */
export function memoryStorageArea(
  initial: Record<string, unknown> = {},
): StorageAreaLike {
  let values = initial;
  return {
    get: async () => values,
    set: async (items) => {
      values = { ...values, ...items };
    },
  };
}
