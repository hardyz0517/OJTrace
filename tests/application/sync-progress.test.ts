import { afterEach, describe, expect, it, vi } from "vitest";
import { codeforcesAdapter } from "../../src/adapters/codeforces";
import {
  accountCollectorFor,
  createAccountCollector,
} from "../../src/application/sync/collect-account";
import { syncEnabledAccounts } from "../../src/application/sync/sync-service";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import { AdapterFailure } from "../../src/domain/errors";
import type {
  AccountSyncProgress,
  FetchInput,
  FetchResult,
  HttpClient,
  PaginationRuntime,
  StoredData,
} from "../../src/domain";
import { accountRecord } from "../account-fixture";

const immediate: PaginationRuntime = { runPage: ({ request }) => request() };
const http: HttpClient = {
  request: async () => {
    throw new Error("unexpected HTTP");
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function fixture(count = 1, initial: Partial<StoredData> = {}) {
  const accounts = Array.from({ length: count }, (_, index) =>
    accountRecord({
      accountId: `account-${index}`,
      source: "codeforces",
      providerAccountKey: `user-${index}`,
      enabled: true,
      authMode: "public-handle",
    }),
  );
  let value: Record<string, unknown> = {
    "ojtrace:data": { ...defaultStoredData(), accounts, ...initial },
  };
  const storage = createStoragePort({
    get: async () => value,
    set: async (next) => {
      value = { ...value, ...next };
    },
  });
  return {
    accounts,
    storage,
    collector: createAccountCollector(storage, http, { pagination: immediate }),
  };
}
function fetched(input: FetchInput, id = "new"): FetchResult {
  return {
    account: {
      accountId: input.account.accountId,
      source: input.account.source,
      providerAccountKey: input.account.providerAccountKey!,
    },
    records: [
      {
        source: input.account.source,
        accountId: input.account.accountId,
        submissionId: id,
        identityQuality: "stable",
        problemId: "1A",
        submittedAt: input.until,
        fetchedAt: input.now,
        verdict: { code: "accepted", raw: "OK" },
      },
    ],
    diagnostics: [],
    coverage: {
      window: { since: input.since, until: input.until },
      pagesFetched: 2,
      acceptedRecords: 1,
      outcome: { status: "complete", evidence: "exhausted" },
    },
  };
}
afterEach(() => vi.restoreAllMocks());

describe("sync progress", () => {
  it("reuses the same task promise, replays its current progress and isolates broken observers", async () => {
    const { accounts, collector } = fixture();
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    const fetcher = vi
      .spyOn(codeforcesAdapter, "fetchRecent")
      .mockImplementation((input) => {
        input.onProgress?.({
          phase: "list",
          pagesFetched: 2,
          recordsFetched: 1,
        });
        started.resolve(input);
        return finish.promise;
      });
    const bad = vi.fn(() => {
      throw new Error("disconnected UI");
    });
    const first = collector.collect({
      account: accounts[0]!,
      window: { since: 0, until: 50 },
      now: 100,
      onProgress: bad,
    });
    const input = await started.promise;
    const updates: unknown[] = [];
    const replay = (update: unknown) => updates.push(update);
    const second = collector.collect({
      account: accounts[0]!,
      window: { since: 0, until: 50 },
      now: 100,
      onProgress: replay,
    });
    expect(second).toBe(first);
    expect(updates[0]).toMatchObject({
      phase: "list",
      pagesFetched: 2,
      recordsFetched: 1,
    });
    input.onProgress?.({
      phase: "details",
      detailsCompleted: 1,
      detailsTotal: 2,
    });
    expect(updates.at(-1)).toMatchObject({
      phase: "details",
      pagesFetched: 2,
      recordsFetched: 1,
      detailsCompleted: 1,
      detailsTotal: 2,
    });
    finish.resolve(fetched(input));
    await first;
    const length = updates.length;
    input.onProgress?.({ phase: "list", pagesFetched: 99 });
    expect(updates).toHaveLength(length);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(bad).toHaveBeenCalled();
  });

  it("reports initial queues and authoritative complete, partial, failed and skipped states for all targets", async () => {
    const { accounts, storage, collector } = fixture(4);
    await storage.transact((data) => ({
      ...data,
      syncStates: {
        [accounts[3]!.accountId]: { stale: true, lastAttemptAt: 99 },
      },
    }));
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => {
        input.onProgress?.({
          phase: "list",
          pagesFetched: 2,
          recordsFetched: 1,
        });
        if (input.account.accountId === accounts[2]!.accountId)
          throw new AdapterFailure({
            source: "codeforces",
            kind: "rate_limited",
            stage: "request",
            messageKey: "source.rateLimited",
            retryable: false,
            requestId: input.requestId,
          });
        const result = fetched(input);
        if (input.account.accountId === accounts[1]!.accountId)
          return {
            ...result,
            coverage: {
              ...result.coverage,
              outcome: { status: "partial", reasons: ["page-limit"] },
            },
          };
        return {
          ...result,
          diagnostics: [
            {
              source: "codeforces",
              code: "optional-detail",
              severity: "warning",
              messageKey: "source.brandingUnavailable",
              retryable: true,
            },
          ],
        };
      },
    );
    const events: AccountSyncProgress[] = [];
    const result = await syncEnabledAccounts(
      storage,
      http,
      {
        force: false,
        now: 100,
        since: 0,
        until: 50,
        onProgress: (progress) => events.push(progress),
      },
      collector,
    );
    expect(events.slice(0, 4).map((progress) => progress.phase)).toEqual([
      "queued",
      "queued",
      "queued",
      "queued",
    ]);
    expect(result.progress.map((progress) => progress.status)).toEqual([
      "complete",
      "partial",
      "failed",
      "skipped",
    ]);
    expect(result.progress[1]?.reasons).toEqual(["page-limit"]);
    expect(result.progress[2]?.messageKey).toBe("source.rateLimited");
    expect(result.progress[3]?.messageKey).toBe("sync.freshness");
    expect(result.progress.every((progress) => progress.phase === "done")).toBe(
      true,
    );
    expect(result.addedRecords).toBe(2);
  });

  it("does not treat missing coverage as complete and survives a throwing batch observer", async () => {
    const { storage, collector } = fixture();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => {
        const result = fetched(input);
        Reflect.deleteProperty(result, "coverage");
        return result;
      },
    );
    const result = await syncEnabledAccounts(
      storage,
      http,
      {
        force: true,
        now: 100,
        since: 0,
        until: 50,
        onProgress: () => {
          throw new Error("closed tab");
        },
      },
      collector,
    );
    expect(result.progress[0]).toMatchObject({
      status: "partial",
      reasons: ["unverified-coverage"],
    });
    expect(result.data.submissions).toHaveLength(1);
  });

  it("reclassifies a settled result as cancelled when clear invalidates it before commit", async () => {
    const { storage, collector } = fixture();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => fetched(input),
    );
    const committing = deferred<void>();
    const release = deferred<void>();
    const original = storage.transact;
    vi.spyOn(storage, "transact").mockImplementationOnce(async (operation) => {
      committing.resolve();
      await release.promise;
      return original(operation);
    });
    const events: AccountSyncProgress[] = [];
    const pending = syncEnabledAccounts(
      storage,
      http,
      {
        force: true,
        now: 100,
        since: 0,
        until: 50,
        onProgress: (progress) => events.push(progress),
      },
      collector,
    );
    await committing.promise;
    expect(events.at(-1)?.status).toBe("complete");
    collector.cancelAll();
    release.resolve();
    const result = await pending;
    expect(result.progress[0]).toMatchObject({
      status: "cancelled",
      messageKey: "sync.cancelled",
    });
    expect(events.at(-1)?.status).toBe("cancelled");
    expect(result.addedRecords).toBe(0);
    expect(result.data.submissions).toEqual([]);
  });

  it("counts new retained keys even when retention keeps total length unchanged", async () => {
    const { storage, collector } = fixture();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => fetched(input),
    );
    const first = await syncEnabledAccounts(
      storage,
      http,
      { force: true, now: 100, since: 0, until: 50 },
      collector,
    );
    expect(first.addedRecords).toBe(1);
    await storage.transact((data) => ({
      ...data,
      preferences: { ...data.preferences, retentionPerAccount: 1 },
    }));
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => fetched(input, "replacement"),
    );
    const second = await syncEnabledAccounts(
      storage,
      http,
      { force: true, now: 101, since: 0, until: 60 },
      collector,
    );
    expect(second.data.submissions).toHaveLength(1);
    expect(second.addedRecords).toBe(1);
    const third = await syncEnabledAccounts(
      storage,
      http,
      { force: true, now: 102, since: 0, until: 60 },
      collector,
    );
    expect(third.addedRecords).toBe(0);
  });

  it("shares the default collector across concurrent batches with the same window and counts new records once", async () => {
    const { storage } = fixture();
    const collect = vi.spyOn(accountCollectorFor(storage, http), "collect");
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    const fetcher = vi
      .spyOn(codeforcesAdapter, "fetchRecent")
      .mockImplementation((input) => {
        started.resolve(input);
        return finish.promise;
      });
    const options = { force: true, now: 100, since: 0, until: 50 };
    const first = syncEnabledAccounts(storage, http, options);
    const input = await started.promise;
    const second = syncEnabledAccounts(storage, http, { ...options, now: 101 });
    await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
    finish.resolve(fetched(input));
    const results = await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(results.map((result) => result.addedRecords).sort()).toEqual([0, 1]);
    expect(
      results.every((result) => result.progress[0]?.status === "complete"),
    ).toBe(true);
  });
});
