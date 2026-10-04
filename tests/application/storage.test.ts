import { accountRecord } from "../account-fixture";
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
  it("drops obsolete preference fields and repairs invalid limits without losing accounts", async () => {
    const area = fakeArea();
    const account = accountRecord({
      accountId: "account",
      source: "codeforces",
      enabled: true,
      authMode: "public-handle",
      providerAccountKey: "tourist",
    });
    await area.set({
      "ojtrace:data": {
        ...defaultStoredData(),
        accounts: [account],
        preferences: {
          enabledSources: ["codeforces"],
          retentionPerAccount: -1,
          freshnessCooldownMs: "invalid",
          syncAccountIds: [account.accountId],
        },
      },
    });
    const loaded = await createStoragePort(area).load();
    expect(loaded.accounts).toEqual([account]);
    expect(loaded.preferences).toEqual({
      ...defaultStoredData().preferences,
      syncAccountIds: [account.accountId],
    });
  });

  it("persists the manual sync range across unrelated preference writes", async () => {
    const store = createStoragePort(fakeArea());
    const syncRange = {
      from: 1_800_000_000_000,
      to: 1_800_600_000_000,
      followNow: false,
    };
    await store.transact((current) => ({
      ...current,
      preferences: { ...current.preferences, syncRange },
    }));
    await store.transact((current) => ({
      ...current,
      preferences: { ...current.preferences, syncAccountIds: [] },
    }));
    expect((await store.load()).preferences.syncRange).toEqual(syncRange);
  });

  it("drops an invalid sync range without losing other preferences", async () => {
    const area = fakeArea();
    await area.set({
      "ojtrace:data": {
        ...defaultStoredData(),
        preferences: {
          ...defaultStoredData().preferences,
          syncAccountIds: [],
          syncRange: { from: 100, to: 90, followNow: false },
        },
      },
    });
    const preferences = (await createStoragePort(area).load()).preferences;
    expect(preferences.syncRange).toBeUndefined();
    expect(preferences.syncAccountIds).toEqual([]);
  });

  it("drops a corrupt optional branding cache without losing canonical accounts", async () => {
    const area = fakeArea();
    const account = accountRecord({
      accountId: "a",
      source: "hydroj",
      origin: "https://school.example.org",
      providerAccountKey: "42",
      authMode: "browser-session",
      enabled: true,
    });
    await area.set({
      "ojtrace:data": {
        ...defaultStoredData(),
        accounts: [account],
        instanceBranding: null,
      },
    });
    const loaded = await createStoragePort(area).load();
    expect(loaded.accounts).toEqual([account]);
    expect(loaded.instanceBranding).toEqual({});
  });
  it("initializes defaults and serializes revisioned writes", async () => {
    const area = fakeArea();
    const store = createStoragePort(area);
    expect((await store.load()).revision).toBe(0);
    const first = await store.transact((current) => ({
      ...current,
      preferences: { ...current.preferences, retentionPerAccount: 10 },
    }));
    expect(first.revision).toBe(1);
    const second = await store.transact((current) => ({
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
          accountRecord({
            accountId: "ok",
            source: "codeforces",
            identifier: "u",
            enabled: true,
            authMode: "public-handle",
          }),
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

  it("drops accounts that use removed legacy auth mode values", async () => {
    const area = fakeArea();
    const valid = defaultStoredData();
    await area.set({
      "ojtrace:data": {
        ...valid,
        accounts: [
          {
            accountId: "legacy",
            source: "luogu",
            identifier: "99",
            enabled: true,
            authMode: "browser_session" as never,
          },
        ],
      },
    });
    const loaded = await createStoragePort(area).load();
    expect(loaded.accounts).toEqual([]);
  });

  it("rejects stored accounts that still use the removed top-level Cookie", async () => {
    const area = fakeArea();
    const valid = defaultStoredData();
    await area.set({
      "ojtrace:data": {
        ...valid,
        accounts: [
          {
            accountId: "account",
            source: "luogu",
            identifier: "99",
            enabled: true,
            authMode: "manual-cookie",
            credentials: { __client_id: "client", _uid: "99" },
            cookie: "must-not-survive",
          },
        ],
      },
    });
    const loaded = await createStoragePort(area).load();
    expect(loaded.accounts).toEqual([]);
  });

  it("keeps only valid persisted sync account ids", async () => {
    const area = fakeArea();
    const valid = defaultStoredData();
    await area.set({
      "ojtrace:data": {
        ...valid,
        accounts: [
          accountRecord({
            accountId: "account",
            source: "codeforces",
            identifier: "user",
            enabled: true,
            authMode: "public-handle",
          }),
        ],
        preferences: {
          ...valid.preferences,
          syncAccountIds: ["account", "account", 3, null],
        },
      },
    });
    expect(
      (await createStoragePort(area).load()).preferences.syncAccountIds,
    ).toEqual(["account"]);
  });

  it("clears all local data through the serialized storage port", async () => {
    const area = fakeArea();
    const store = createStoragePort(area);
    await store.transact((current) => ({
      ...current,
      accounts: [
        accountRecord({
          accountId: "a",
          source: "codeforces",
          identifier: "u",
          enabled: true,
          authMode: "public-handle",
        }),
      ],
    }));
    await store.clear();
    expect(await store.load()).toEqual(defaultStoredData());
  });

  it("serializes concurrent mutations without resurrecting a deleted account", async () => {
    const store = createStoragePort(fakeArea());
    await store.transact((data) => ({
      ...data,
      accounts: [
        accountRecord({
          accountId: "a",
          source: "codeforces",
          identifier: "a",
          enabled: true,
          authMode: "public-handle",
        }),
      ],
    }));
    await Promise.all([
      store.transact((data) => ({ ...data, accounts: [] })),
      store.transact((data) => ({
        ...data,
        preferences: { ...data.preferences, retentionPerAccount: 20 },
      })),
    ]);
    expect((await store.load()).accounts).toEqual([]);
    expect((await store.load()).revision).toBe(3);
  });
});
