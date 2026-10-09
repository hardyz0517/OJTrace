import { afterEach, describe, expect, it, vi } from "vitest";
import { codeforcesAdapter } from "../../src/adapters/codeforces";
import { atcoderAdapter } from "../../src/adapters/atcoder";
import { createAccountCollector } from "../../src/application/sync/collect-account";
import { commitCollections } from "../../src/application/sync/commit-collection";
import { syncEnabledAccounts } from "../../src/application/sync/sync-service";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import type {
  FetchInput,
  FetchResult,
  HttpClient,
  PaginationRuntime,
} from "../../src/domain";
import { accountRecord } from "../account-fixture";
import { createPaginationRuntime } from "../../src/platform/network/pagination-throttle";
import { updatePaginationPreference } from "../../src/application/preferences/pagination-preferences";
import { deferred } from "../helpers/deferred";
import { memoryStorageArea } from "../helpers/memory-storage";

const immediate: PaginationRuntime = { runPage: ({ request }) => request() };
const http: HttpClient = {
  request: async () => {
    throw new Error("unexpected HTTP");
  },
};
function fixture(deadlineMs?: number) {
  const account = accountRecord({
    accountId: crypto.randomUUID(),
    source: "codeforces",
    providerAccountKey: "tourist",
    authMode: "public-handle",
    enabled: true,
  });
  const storage = createStoragePort(
    memoryStorageArea({
      "ojtrace:data": {
        ...defaultStoredData(),
        accounts: [account],
        syncStates: { [account.accountId]: { stale: false, lastSuccessAt: 1 } },
      },
    }),
  );
  return {
    account,
    storage,
    collector: createAccountCollector(storage, http, {
      pagination: immediate,
      deadlineMs,
    }),
  };
}
function fetched(input: FetchInput, partial = false): FetchResult {
  return {
    account: {
      accountId: input.account.accountId,
      source: "codeforces",
      providerAccountKey: "tourist",
    },
    records: [
      {
        accountId: input.account.accountId,
        source: "codeforces",
        submissionId: String(input.until),
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
      pagesFetched: 1,
      acceptedRecords: 1,
      outcome: partial
        ? { status: "partial", reasons: ["page-limit"] }
        : { status: "complete", evidence: "exhausted" },
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("single-account collection", () => {
  it("uses the production 15-minute deadline and keeps a task running beyond the old four-minute limit", async () => {
    vi.useFakeTimers();
    const { account, collector } = fixture();
    const started = deferred<FetchInput>();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => {
        started.resolve(input);
        await new Promise<void>((resolve) =>
          input.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        return {
          ...fetched(input, true),
          coverage: {
            ...fetched(input, true).coverage,
            outcome: { status: "partial", reasons: ["deadline"] },
          },
        };
      },
    );
    const operation = collector.collect({
      account,
      window: { since: 0, until: 50 },
      now: 100,
    });
    const input = await started.promise;
    await vi.advanceTimersByTimeAsync(240_000);
    expect(input.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(659_999);
    expect(input.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(input.signal.reason).toEqual({ kind: "deadline" });
    expect((await operation).result.coverage?.outcome).toEqual({
      status: "partial",
      reasons: ["deadline"],
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("binds each source's configuration to its real list origin including the AtCoder public API", async () => {
    const { account, storage } = fixture();
    const atcoder = accountRecord({
      accountId: "at",
      source: "atcoder",
      providerAccountKey: "tester",
      authMode: "public-handle",
      enabled: true,
    });
    await storage.transact((data) => ({
      ...data,
      accounts: [account, atcoder],
    }));
    await updatePaginationPreference(storage, "codeforces", {
      intervalMs: 2_000,
      jitterMs: 0,
    });
    await updatePaginationPreference(storage, "atcoder", {
      intervalMs: 5_000,
      jitterMs: 1_000,
    });
    const delays: number[] = [];
    const collector = createAccountCollector(storage, http, {
      pagination: createPaginationRuntime({
        random: () => 1,
        sleep: async (delay) => {
          delays.push(delay);
        },
      }),
    });
    const fetch = async (input: FetchInput) => {
      const origin =
        input.account.source === "atcoder"
          ? "https://kenkoooo.com"
          : "https://codeforces.com";
      for (let page = 0; page < 2; page++)
        await input.pagination.runPage({
          origin,
          signal: input.signal,
          request: async () => undefined,
        });
      return {
        account: {
          accountId: input.account.accountId,
          source: input.account.source,
          providerAccountKey: input.account.providerAccountKey!,
        },
        records: [],
        diagnostics: [],
        coverage: {
          window: { since: input.since, until: input.until },
          pagesFetched: 2,
          acceptedRecords: 0,
          outcome: { status: "complete", evidence: "exhausted" },
        },
      } satisfies FetchResult;
    };
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(fetch);
    vi.spyOn(atcoderAdapter, "fetchRecent").mockImplementation(fetch);
    const result = await syncEnabledAccounts(
      storage,
      http,
      { force: true, now: 100 },
      collector,
    );
    expect(delays.sort((a, b) => a - b)).toEqual([2_000, 6_000]);
    expect(result.progress.map((item) => item.status)).toEqual([
      "complete",
      "complete",
    ]);
  });
  it("freezes a sync's policy while applying saved settings to the next queued sync without splitting origin queues", async () => {
    const { storage } = fixture();
    await updatePaginationPreference(storage, "codeforces", {
      intervalMs: 2_000,
      jitterMs: 0,
    });
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const collector = createAccountCollector(storage, http, {
      pagination: createPaginationRuntime({ sleep }),
    });
    const started = deferred<void>();
    const finish = deferred<void>();
    let calls = 0;
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => {
        const firstRun = ++calls === 1;
        await input.pagination.runPage({
          origin: "https://codeforces.com",
          signal: input.signal,
          request: async () => {
            if (firstRun) {
              started.resolve();
              await finish.promise;
            }
          },
        });
        await input.pagination.runPage({
          origin: "https://codeforces.com",
          signal: input.signal,
          request: async () => undefined,
        });
        return fetched(input);
      },
    );
    const first = syncEnabledAccounts(
      storage,
      http,
      { force: true, now: 100 },
      collector,
    );
    await started.promise;
    await updatePaginationPreference(storage, "codeforces", {
      intervalMs: 4_000,
      jitterMs: 0,
    });
    const second = syncEnabledAccounts(
      storage,
      http,
      { force: true, now: 100 },
      collector,
    );
    finish.resolve();
    await Promise.all([first, second]);
    expect(calls).toBe(2);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([
      2_000, 4_000, 4_000,
    ]);
  });
  it("shares exactly identical windows, serializes a different until and refuses a third window", async () => {
    const { account, collector } = fixture();
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    const calls: number[] = [];
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation((input) => {
      calls.push(input.until);
      if (calls.length === 1) {
        started.resolve(input);
        return finish.promise;
      }
      return Promise.resolve(fetched(input));
    });
    const first = collector.collect({
      account,
      window: { since: 0, until: 50 },
      now: 100,
    });
    expect(
      collector.collect({ account, window: { since: 0, until: 50 }, now: 100 }),
    ).toBe(first);
    const input = await started.promise;
    const second = collector.collect({
      account,
      window: { since: 0, until: 60 },
      now: 100,
    });
    expect(
      collector.collect({ account, window: { since: 0, until: 60 }, now: 100 }),
    ).toBe(second);
    expect(
      (
        await collector.collect({
          account,
          window: { since: 0, until: 70 },
          now: 100,
        })
      ).result.skipped,
    ).toBe("busy");
    expect(calls).toEqual([50]);
    finish.resolve(fetched(input));
    const results = await Promise.all([first, second]);
    expect(calls).toEqual([50, 60]);
    expect(results.map((item) => item.result.records[0]?.submittedAt)).toEqual([
      50, 60,
    ]);
  });

  it("revalidates a queued account revision and never dispatches stale credentials", async () => {
    const { account, storage, collector } = fixture();
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    const fetcher = vi
      .spyOn(codeforcesAdapter, "fetchRecent")
      .mockImplementation((input) => {
        started.resolve(input);
        return finish.promise;
      });
    const first = collector.collect({
      account,
      window: { since: 0, until: 50 },
      now: 100,
    });
    const input = await started.promise;
    const second = collector.collect({
      account,
      window: { since: 0, until: 60 },
      now: 100,
    });
    await storage.transact((data) => ({
      ...data,
      accounts: data.accounts.map((item) => ({
        ...item,
        credentialRevision: 2,
      })),
    }));
    finish.resolve(fetched(input));
    await first;
    expect((await second).result.skipped).toBe("superseded");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("cancels without releasing a running callback and discards its late result", async () => {
    const { account, collector } = fixture();
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    let calls = 0;
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation((input) => {
      calls++;
      if (calls === 1) {
        started.resolve(input);
        return finish.promise;
      }
      return Promise.resolve(fetched(input));
    });
    const first = collector.collect({
      account,
      window: { since: 0, until: 50 },
      now: 100,
    });
    const input = await started.promise;
    collector.cancel(account.accountId);
    const second = collector.collect({
      account,
      window: { since: 0, until: 60 },
      now: 100,
    });
    await Promise.resolve();
    expect(calls).toBe(1);
    finish.resolve(fetched(input));
    expect((await first).result).toMatchObject({
      skipped: "cancelled",
      records: [],
    });
    expect((await second).result.coverage?.outcome.status).toBe("complete");
  });

  it("uses the owner deadline reason and merges verified partial results without success timestamps", async () => {
    vi.useFakeTimers();
    const { account, storage, collector } = fixture(100);
    const started = deferred<FetchInput>();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => {
        started.resolve(input);
        await new Promise<void>((resolve) =>
          input.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        return {
          ...fetched(input, true),
          coverage: {
            ...fetched(input, true).coverage,
            outcome: { status: "partial", reasons: ["deadline"] },
          },
        };
      },
    );
    const operation = collector.collect({
      account,
      window: { since: 0, until: 50 },
      now: 100,
    });
    const input = await started.promise;
    await vi.advanceTimersByTimeAsync(100);
    expect(input.signal.reason).toEqual({ kind: "deadline" });
    const result = await operation;
    const data = await storage.transact((value) =>
      commitCollections(value, [result]),
    );
    expect(data.submissions).toHaveLength(1);
    expect(data.syncStates[account.accountId]).toMatchObject({
      stale: true,
      lastAttemptAt: 100,
      lastSuccessAt: 1,
    });
    expect(data.syncStates[account.accountId]?.lastError).toBeUndefined();
  });

  it("guards both time endpoints and diagnoses a misbehaving adapter instead of claiming complete", async () => {
    const { account, storage, collector } = fixture();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => {
        const result = fetched(input);
        const record = result.records[0]!;
        return {
          ...result,
          records: [
            record,
            { ...record, submissionId: "before", submittedAt: 9 },
            { ...record, submissionId: "after", submittedAt: 51 },
          ],
        };
      },
    );
    const result = await collector.collect({
      account,
      window: { since: 10, until: 50 },
      now: 100,
    });
    expect(result.result.records).toHaveLength(1);
    expect(result.result.coverage?.outcome).toEqual({
      status: "partial",
      reasons: ["invalid-record"],
    });
    expect(result.result.diagnostics[0]?.code).toBe(
      "window-contract-violation",
    );
    const data = await storage.transact((value) =>
      commitCollections(value, [result]),
    );
    expect(data.submissions).toHaveLength(1);
    expect(data.syncStates[account.accountId]?.lastSuccessAt).toBe(1);
  });

  it("rejects expired or future explicit bounds before adapter calls", async () => {
    const { account, collector } = fixture();
    const fetcher = vi.spyOn(codeforcesAdapter, "fetchRecent");
    expect(() =>
      collector.collect({
        account,
        window: { since: 0, until: 100 },
        now: 40 * 86_400_000,
      }),
    ).toThrow();
    expect(() =>
      collector.collect({
        account,
        window: { since: 0, until: 101 },
        now: 100,
      }),
    ).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects the whole run when an adapter record belongs to a different provider", async () => {
    const { account, collector } = fixture();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => {
        const result = fetched(input);
        return {
          ...result,
          records: [
            ...result.records,
            {
              ...result.records[0]!,
              submissionId: "wrong-provider",
              providerAccountKey: "other",
            },
          ],
        };
      },
    );
    const result = await collector.collect({
      account,
      window: { since: 0, until: 50 },
      now: 100,
    });
    expect(result.result.records).toEqual([]);
    expect(result.result.error?.messageKey).toBe("account.identityChanged");
    expect(result.result.coverage).toBeUndefined();
  });

  it("invalidates settled results before a clear transaction and prevents late refill", async () => {
    const { account, storage, collector } = fixture();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation(
      async (input) => fetched(input),
    );
    const result = await collector.collect({
      account,
      window: { since: 0, until: 50 },
      now: 100,
    });
    collector.cancelAll();
    await storage.transact((data) => ({ ...data, submissions: [] }));
    expect(collector.isCurrent(result)).toBe(false);
    const data = await storage.transact((value) =>
      commitCollections(
        value,
        [result].filter((item) => collector.isCurrent(item)),
      ),
    );
    expect(data.submissions).toEqual([]);
  });

  it("allows the same window immediately after clear while holding the old callback lock", async () => {
    const { account, collector } = fixture();
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    let calls = 0;
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation((input) => {
      calls++;
      if (calls === 1) {
        started.resolve(input);
        return finish.promise;
      }
      return Promise.resolve(fetched(input));
    });
    const request = { account, window: { since: 0, until: 50 }, now: 100 };
    const old = collector.collect(request);
    const input = await started.promise;
    const oldQueued = collector.collect({
      ...request,
      window: { since: 0, until: 60 },
    });
    collector.cancelAll();
    const fresh = collector.collect(request);
    expect(fresh).not.toBe(old);
    await Promise.resolve();
    expect(calls).toBe(1);
    finish.resolve(fetched(input));
    const [oldResult, queuedResult, freshResult] = await Promise.all([
      old,
      oldQueued,
      fresh,
    ]);
    expect(oldResult.result.skipped).toBe("cancelled");
    expect(queuedResult.result.skipped).toBe("cancelled");
    expect(freshResult.result.coverage?.outcome.status).toBe("complete");
    expect(collector.isCurrent(freshResult)).toBe(true);
    expect(calls).toBe(2);
  });

  it("cancels active tasks on clear and discards even an adapter that ignores abort", async () => {
    const { storage, collector } = fixture();
    const started = deferred<FetchInput>();
    const finish = deferred<FetchResult>();
    vi.spyOn(codeforcesAdapter, "fetchRecent").mockImplementation((input) => {
      started.resolve(input);
      return finish.promise;
    });
    const syncing = syncEnabledAccounts(
      storage,
      http,
      { force: true, now: 100 },
      collector,
    );
    const input = await started.promise;
    collector.cancelAll();
    await storage.transact((data) => ({ ...data, submissions: [] }));
    expect(input.signal.aborted).toBe(true);
    finish.resolve(fetched(input));
    const synced = await syncing;
    expect(synced.data.submissions).toEqual([]);
    expect(synced.sources).toEqual([]);
  });

  it("uses lastAttemptAt to prevent immediate rescan after partial and returns the skip explanation", async () => {
    const { account, storage, collector } = fixture();
    const fetcher = vi
      .spyOn(codeforcesAdapter, "fetchRecent")
      .mockImplementation(async (input) => fetched(input, true));
    await syncEnabledAccounts(
      storage,
      http,
      { force: true, now: 100 },
      collector,
    );
    const repeated = await syncEnabledAccounts(
      storage,
      http,
      { force: false, now: 101 },
      collector,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(repeated.sources[0]?.skipped).toBe("freshness");
    expect(repeated.data.syncStates[account.accountId]?.lastAttemptAt).toBe(
      100,
    );
  });
});
