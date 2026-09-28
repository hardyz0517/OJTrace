import { describe, expect, it } from "vitest";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";

function fakeArea() {
  let value: Record<string, unknown> = {};
  return {
    get: async () => value,
    set: async (next: Record<string, unknown>) => {
      value = { ...value, ...next };
    },
  };
}

describe("storage port", () => {
  it("initializes defaults and serializes revisioned writes", async () => {
    const area = fakeArea();
    const store = createStoragePort(area);
    expect((await store.load()).revision).toBe(0);
    const first = await store.update((current) => ({
      ...current,
      preferences: { ...current.preferences, retentionPerAccount: 10 },
    }));
    expect(first.revision).toBe(1);
    const second = await store.update((current) => ({
      ...current,
      accounts: [],
    }));
    expect(second.revision).toBe(2);
    expect((await store.load()).preferences.retentionPerAccount).toBe(10);
  });

  it("recovers invalid persisted data to safe defaults", async () => {
    const area = fakeArea();
    await area.set({ "ojtrace:data": { unexpected: true } });
    const store = createStoragePort(area);
    expect(await store.load()).toEqual(defaultStoredData());
  });
});
