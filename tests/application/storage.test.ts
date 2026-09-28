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

  it("drops malformed account and submission entries while loading", async () => {
    const area = fakeArea();
    const valid = defaultStoredData();
    await area.set({
      "ojtrace:data": {
        ...valid,
        accounts: [
          {
            accountId: "ok",
            source: "codeforces",
            identifier: "u",
            enabled: true,
            authMode: "public",
          },
          { bad: true },
        ],
        submissions: [
          {
            source: "codeforces",
            accountId: "ok",
            submissionId: "1",
            submittedAt: 1,
            fetchedAt: 1,
          },
          { bad: true },
        ],
      },
    });
    const loaded = await createStoragePort(area).load();
    expect(loaded.accounts).toHaveLength(1);
    expect(loaded.submissions).toHaveLength(1);
  });

  it("clears all local data through the serialized storage port", async () => {
    const area = fakeArea();
    const store = createStoragePort(area);
    await store.update((current) => ({
      ...current,
      accounts: [
        {
          accountId: "a",
          source: "codeforces",
          identifier: "u",
          enabled: true,
          authMode: "public",
        },
      ],
    }));
    await store.clear();
    expect(await store.load()).toEqual(defaultStoredData());
  });

  it("preserves a concurrent account write when a stale mutator commits", async () => {
    let value: Record<string, unknown> = {
      "ojtrace:data": defaultStoredData(),
    };
    let reads = 0;
    const area = {
      get: async () => {
        reads += 1;
        return value;
      },
      set: async (next: Record<string, unknown>) => {
        value = { ...value, ...next };
      },
    };
    const storeA = createStoragePort(area);
    const storeB = createStoragePort(area);
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const a = storeA.update(async (current) => {
      await gateA;
      return {
        ...current,
        accounts: [
          {
            accountId: "a",
            source: "codeforces",
            identifier: "a",
            enabled: true,
            authMode: "public",
          },
        ],
      };
    });
    const b = storeB.update((current) => ({
      ...current,
      accounts: [
        {
          accountId: "b",
          source: "codeforces",
          identifier: "b",
          enabled: true,
          authMode: "public",
        },
      ],
    }));
    await b;
    releaseA();
    await a;
    expect(
      (await storeA.load()).accounts.map((account) => account.accountId).sort(),
    ).toEqual(["a", "b"]);
    expect(reads).toBeGreaterThan(2);
  });
});
