import { afterEach, describe, expect, it, vi } from "vitest";
import { codeforcesAdapter } from "../../src/adapters/codeforces";
import { createAccountService } from "../../src/application/accounts/account-service";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import { syncEnabledAccounts } from "../../src/application/sync/sync-service";
import type { FetchInput, FetchResult, HttpClient } from "../../src/domain";
import { accountRecord } from "../account-fixture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const account = accountRecord({
    accountId: crypto.randomUUID(),
    source: "codeforces",
    providerAccountKey: "tourist",
    enabled: true,
    authMode: "public-handle",
  });
  let data: Record<string, unknown> = {
    "ojtrace:data": { ...defaultStoredData(), accounts: [account] },
  };
  const storage = createStoragePort({
    get: async () => data,
    set: async (value) => {
      data = { ...data, ...value };
    },
  });
  const http: HttpClient = {
    request: async () => {
      throw new Error("Unexpected request");
    },
  };
  return { account, storage, http };
}
function result(input: FetchInput, submissionId: string): FetchResult {
  return {
    account: {
      accountId: input.account.accountId,
      source: input.account.source,
      providerAccountKey: "tourist",
    },
    records: [
      {
        accountId: input.account.accountId,
        source: "codeforces",
        submissionId,
        problemId: "1A",
        identityQuality: "stable",
        submittedAt: 10,
        fetchedAt: input.now,
        verdict: { code: "accepted", raw: "OK" },
      },
    ],
    diagnostics: [],
    hasMore: false,
  };
}
afterEach(() => vi.restoreAllMocks());

describe("sync commit races", () => {
  it("discards records and UI results when an account is deleted during sync", async () => {
    const { account, storage, http } = fixture();
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation((input) => {
      started.resolve(input);
      return finish.promise;
    });
    const syncing = syncEnabledAccounts(storage, http, {
      force: true,
      now: 100,
      since: 0,
    });
    const input = await started.promise;
    await createAccountService(storage).remove(account.accountId);
    finish.resolve(result(input, "old"));
    const synced = await syncing;
    expect(synced.sources).toEqual([]);
    expect(synced.data.accounts).toEqual([]);
    expect(synced.data.submissions).toEqual([]);
    expect(synced.data.syncStates).toEqual({});
  });

  it("keeps the new credential version when an old fetch ignores cancellation", async () => {
    const { account, storage, http } = fixture();
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation((input) => {
      if (input.account.credentialRevision === 1) {
        started.resolve(input);
        return finish.promise;
      }
      return Promise.resolve(result(input, "new"));
    });
    const oldSync = syncEnabledAccounts(storage, http, {
      force: true,
      now: 100,
      since: 0,
    });
    const oldInput = await started.promise;
    await storage.transact((data) => ({
      ...data,
      accounts: data.accounts.map((item) => ({
        ...item,
        credentialRevision: 2,
      })),
    }));
    const newSync = await syncEnabledAccounts(storage, http, {
      force: true,
      now: 200,
      since: 0,
    });
    expect(oldInput.signal.aborted).toBe(true);
    finish.resolve(result(oldInput, "old"));
    const oldResult = await oldSync;
    expect(oldResult.sources).toEqual([]);
    expect(newSync.sources).toHaveLength(1);
    const stored = await storage.load();
    expect(stored.submissions.map((item) => item.submissionId)).toEqual([
      "new",
    ]);
    expect(stored.syncStates[account.accountId]?.lastSuccessAt).toBe(200);
  });

  it("fetches a wider time window after a narrower in-flight request", async () => {
    const { storage, http } = fixture();
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    const windows: number[] = [];
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation((input) => {
      windows.push(input.since!);
      if (windows.length === 1) {
        started.resolve(input);
        return finish.promise;
      }
      return Promise.resolve(result(input, "history"));
    });
    const first = syncEnabledAccounts(storage, http, {
      force: true,
      now: 100,
      since: 50,
    });
    const input = await started.promise;
    const second = syncEnabledAccounts(storage, http, {
      force: true,
      now: 200,
      since: 0,
    });
    finish.resolve(result(input, "recent"));
    await Promise.all([first, second]);
    expect(windows).toEqual([50, 0]);
    expect((await storage.load()).submissions).toHaveLength(2);
  });

  it("does not let a delayed old snapshot cancel a newer credential fetch", async () => {
    const { account, storage, http } = fixture();
    const snapshot = await storage.load();
    const staleLoad = deferred<typeof snapshot>();
    const reading = deferred<void>();
    vi.spyOn(storage, "load").mockImplementationOnce(() => {
      reading.resolve();
      return staleLoad.promise;
    });
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    const fetching = vi
      .spyOn(codeforcesAdapter, "fetchRecent")
      .mockImplementation((input) => {
        started.resolve(input);
        return finish.promise;
      });
    const oldSync = syncEnabledAccounts(storage, http, {
      force: true,
      now: 100,
      since: 0,
    });
    await reading.promise;
    await storage.transact((data) => ({
      ...data,
      accounts: data.accounts.map((item) => ({
        ...item,
        credentialRevision: 2,
      })),
    }));
    const newSync = syncEnabledAccounts(storage, http, {
      force: true,
      now: 200,
      since: 50,
    });
    const newInput = await started.promise;
    staleLoad.resolve(snapshot);
    finish.resolve(result(newInput, "new"));
    const [oldResult, newResult] = await Promise.all([oldSync, newSync]);
    expect(fetching).toHaveBeenCalledTimes(1);
    expect(newInput.signal.aborted).toBe(false);
    expect(oldResult.sources).toEqual([]);
    expect(newResult.sources).toHaveLength(1);
    const stored = await storage.load();
    expect(stored.submissions.map((item) => item.submissionId)).toEqual([
      "new",
    ]);
    expect(stored.syncStates[account.accountId]?.lastSuccessAt).toBe(200);
  });
});
