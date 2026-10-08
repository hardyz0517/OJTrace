import { describe, expect, it, vi } from "vitest";
import { updatePaginationPreference } from "../../src/application/preferences/pagination-preferences";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import type { PaginationPolicy, SourceId } from "../../src/domain";
import { accountRecord } from "../account-fixture";

function fixture() {
  let value: Record<string, unknown> = {};
  const area = {
    get: async () => structuredClone(value),
    set: vi.fn(async (next: Record<string, unknown>) => {
      value = { ...value, ...structuredClone(next) };
    }),
  };
  return { area, storage: createStoragePort(area) };
}

describe("pagination preferences", () => {
  it("patches each source without losing simultaneous account selections or range writes", async () => {
    const { storage } = fixture();
    const range = { from: 100, to: 200, followNow: false };
    await Promise.all([
      updatePaginationPreference(storage, "codeforces", {
        intervalMs: 3_000,
        jitterMs: 1_000,
      }),
      storage.transact((data) => ({
        ...data,
        preferences: {
          ...data.preferences,
          syncRange: range,
          syncAccountIds: [],
        },
      })),
      updatePaginationPreference(storage, "qoj", {
        intervalMs: 2_000,
        jitterMs: 0,
      }),
    ]);
    expect((await storage.load()).preferences).toEqual({
      ...defaultStoredData().preferences,
      syncRange: range,
      syncAccountIds: [],
      paginationBySource: {
        codeforces: { intervalMs: 3_000, jitterMs: 1_000 },
        qoj: { intervalMs: 2_000, jitterMs: 0 },
      },
    });
    await updatePaginationPreference(storage, "codeforces", null);
    expect((await storage.load()).preferences.paginationBySource).toEqual({
      qoj: { intervalMs: 2_000, jitterMs: 0 },
    });
    await updatePaginationPreference(storage, "qoj", null);
    expect(
      (await storage.load()).preferences.paginationBySource,
    ).toBeUndefined();
  });

  it("preserves valid entries and accounts when optional persisted settings are corrupt", async () => {
    const { area, storage } = fixture();
    const account = accountRecord({
      accountId: "cf",
      source: "codeforces",
      enabled: true,
      authMode: "public-handle",
    });
    await area.set({
      "ojtrace:data": {
        ...defaultStoredData(),
        accounts: [account],
        preferences: {
          ...defaultStoredData().preferences,
          paginationBySource: {
            codeforces: { intervalMs: 4_000, jitterMs: 500 },
            qoj: { intervalMs: 1_500, jitterMs: 5_000 },
            unknown: { intervalMs: 2_000, jitterMs: 0 },
          },
        },
      },
    });
    const loaded = await storage.load();
    expect(loaded.accounts).toEqual([account]);
    expect(loaded.preferences.paginationBySource).toEqual({
      codeforces: { intervalMs: 4_000, jitterMs: 500 },
    });
    await updatePaginationPreference(storage, "luogu", {
      intervalMs: 2_000,
      jitterMs: 0,
    });
    expect(
      (await storage.load()).preferences.paginationBySource?.codeforces,
    ).toEqual({ intervalMs: 4_000, jitterMs: 500 });
  });

  it("rejects invalid writes without changing storage and recovers after a persistence failure", async () => {
    const { area, storage } = fixture();
    await expect(
      updatePaginationPreference(storage, "unknown" as SourceId, null),
    ).rejects.toThrow(RangeError);
    await expect(
      updatePaginationPreference(storage, "qoj", {
        intervalMs: 0,
        jitterMs: 0,
      } as PaginationPolicy),
    ).rejects.toThrow(RangeError);
    expect(area.set).not.toHaveBeenCalled();
    await updatePaginationPreference(storage, "qoj", {
      intervalMs: 2_000,
      jitterMs: 0,
    });
    area.set.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(
      updatePaginationPreference(storage, "qoj", {
        intervalMs: 3_000,
        jitterMs: 0,
      }),
    ).rejects.toThrow("storage unavailable");
    expect(
      (await storage.load()).preferences.paginationBySource?.qoj?.intervalMs,
    ).toBe(2_000);
    await updatePaginationPreference(storage, "qoj", {
      intervalMs: 4_000,
      jitterMs: 0,
    });
    expect(
      (await storage.load()).preferences.paginationBySource?.qoj?.intervalMs,
    ).toBe(4_000);
    await storage.clear();
    expect(
      (await storage.load()).preferences.paginationBySource,
    ).toBeUndefined();
  });
});
