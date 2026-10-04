import { afterEach, describe, expect, it, vi } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import { createAccountService } from "../../src/application/accounts/account-service";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import { createAccountCollector } from "../../src/application/sync/collect-account";
import { commitCollections } from "../../src/application/sync/commit-collection";
import { syncEnabledAccounts } from "../../src/application/sync/sync-service";
import { activityScheduleKey } from "../../src/domain/activity-schedule";
import type { FetchInput, FetchResult, HttpClient } from "../../src/domain";
import { accountRecord } from "../account-fixture";

const origin = "https://school.example.org";
const now = Date.parse("2026-10-04T00:00:00Z");
const window = { since: now - 7 * 86400_000, until: now };
const account = accountRecord({
  accountId: "student",
  source: "hydroj",
  origin,
  domainId: "student",
  providerAccountKey: "42",
  authMode: "browser-session",
  enabled: true,
});
const schedule = {
  source: "hydroj" as const,
  origin,
  domainId: "student",
  activityId: "0".repeat(24),
  beginAt: now - 20 * 86400_000,
  endAt: now - 10 * 86400_000,
  checkedAt: now,
};
const immediate = {
  runPage: <T>({ request }: { request: () => Promise<T> }) => request(),
};
const http: HttpClient = {
  request: async () => {
    throw new Error("unexpected HTTP");
  },
};
function fixture(client: HttpClient = http) {
  let state: Record<string, unknown> = {
    "ojtrace:data": { ...defaultStoredData(), accounts: [account] },
  };
  const area = {
    get: async () => state,
    set: async (next: Record<string, unknown>) => {
      state = next;
    },
  };
  const storage = createStoragePort(area);
  const collector = createAccountCollector(storage, client, {
    pagination: immediate,
  });
  return { area, storage, collector };
}
function fetched(input: FetchInput): FetchResult {
  return {
    account: {
      accountId: account.accountId,
      source: "hydroj",
      providerAccountKey: "42",
    },
    records: [],
    diagnostics: [],
    activitySchedules: [schedule],
    coverage: {
      window: { since: input.since, until: input.until },
      pagesFetched: 2,
      acceptedRecords: 0,
      outcome: { status: "complete", evidence: "all-streams" },
    },
  };
}
afterEach(() => vi.restoreAllMocks());

describe("activity schedule application lifecycle", () => {
  it("advances lastSuccessAt without refreshing cache checkedAt for a cached exclusion", async () => {
    const requests: string[] = [];
    const client: HttpClient = {
      async request(_source, url) {
        requests.push(url);
        const path = new URL(url).pathname;
        const text = path.endsWith("/user/42")
          ? JSON.stringify({
              tdocs: [
                {
                  docId: schedule.activityId,
                  title: "Old homework",
                  rule: "homework",
                },
              ],
            })
          : path.endsWith("/record")
            ? JSON.stringify({
                page: 1,
                rdocs: [],
                hasMore: false,
                tdoc: {
                  docId: schedule.activityId,
                  domainId: "student",
                  rule: "homework",
                  beginAt: new Date(schedule.beginAt).toISOString(),
                  endAt: new Date(schedule.endAt).toISOString(),
                },
              })
            : `<script>window.UserContext = '{"_id":42,"uname":"tester"}';</script>`;
        return {
          url,
          text,
          status: 200,
          contentType: text.startsWith("{") ? "application/json" : "text/html",
          headers: new Headers(),
        };
      },
    };
    const f = fixture(client);
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
    });
    await syncEnabledAccounts(
      f.storage,
      client,
      { force: true, now, ...window },
      f.collector,
    );
    expect(
      requests.filter((url) => new URL(url).searchParams.has("tid")),
    ).toHaveLength(1);
    requests.length = 0;
    const result = await syncEnabledAccounts(
      f.storage,
      client,
      { force: true, now: now + 100, ...window },
      f.collector,
    );
    expect(
      result.data.activitySchedules[activityScheduleKey(schedule)]?.checkedAt,
    ).toBe(now);
    expect(result.data.syncStates[account.accountId]).toMatchObject({
      lastAttemptAt: now + 100,
      lastSuccessAt: now + 100,
      stale: false,
    });
    expect(requests.some((url) => new URL(url).searchParams.has("tid"))).toBe(
      false,
    );
    expect(result.sources[0]?.coverage?.outcome).toEqual({
      status: "complete",
      evidence: "all-streams",
    });
    expect(result.progress[0]?.status).toBe("complete");
    expect(result.progress[0]?.reasons).toBeUndefined();
  });
  it("persists and reloads observations, injects only the selected scope and keeps caches out of the UI state", async () => {
    const f = fixture();
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
    });
    const fetch = vi
      .spyOn(hydroOJAdapter, "fetchRecent")
      .mockImplementation(async (input) => fetched(input));
    await syncEnabledAccounts(
      f.storage,
      http,
      { force: true, now, ...window },
      f.collector,
    );
    const reloaded = createStoragePort(f.area);
    const state = await reloaded.load();
    expect(state.activitySchedules[activityScheduleKey(schedule)]).toEqual(
      schedule,
    );
    expect(publicStoredData(state)).not.toHaveProperty("activitySchedules");
    await reloaded.transact((data) => ({
      ...data,
      activitySchedules: {
        ...data.activitySchedules,
        other: { ...schedule, domainId: "teacher" },
      },
    }));
    await syncEnabledAccounts(
      reloaded,
      http,
      { force: true, now, ...window, recheckActivities: true },
      createAccountCollector(reloaded, http, { pagination: immediate }),
    );
    expect(fetch.mock.calls[1]![0]).toMatchObject({
      activitySchedules: [schedule],
      recheckActivities: true,
    });
  });
  it("drops schedules on cancellation and rejects invalidated/deleted account commits", async () => {
    const f = fixture();
    let finish!: (result: FetchResult) => void;
    let started!: (input: FetchInput) => void;
    const start = new Promise<FetchInput>((resolve) => {
      started = resolve;
    });
    vi.spyOn(hydroOJAdapter, "fetchRecent").mockImplementation((input) => {
      started(input);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const task = f.collector.collect({ account, window, now });
    const input = await start;
    f.collector.cancel(account.accountId);
    finish(fetched(input));
    const cancelled = await task;
    expect(cancelled.result.skipped).toBe("cancelled");
    expect(
      commitCollections(await f.storage.load(), [cancelled]).activitySchedules,
    ).toEqual({});
    const valid = {
      ...cancelled,
      result: {
        ...cancelled.result,
        skipped: undefined,
        activitySchedules: [schedule],
      },
    };
    const state = await f.storage.load();
    expect(
      commitCollections({ ...state, accounts: [] }, [valid]).activitySchedules,
    ).toEqual({});
    expect(
      commitCollections(
        {
          ...state,
          accounts: [
            { ...account, credentialRevision: account.credentialRevision + 1 },
          ],
        },
        [valid],
      ).activitySchedules,
    ).toEqual({});
  });
  it("does not coalesce a full recheck with an in-flight cache-using task", async () => {
    const f = fixture();
    let finish!: (result: FetchResult) => void;
    let started!: (input: FetchInput) => void;
    const start = new Promise<FetchInput>((resolve) => {
      started = resolve;
    });
    const fetch = vi
      .spyOn(hydroOJAdapter, "fetchRecent")
      .mockImplementation((input) => {
        if (input.recheckActivities) return Promise.resolve(fetched(input));
        started(input);
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
    });
    const first = f.collector.collect({ account, window, now });
    const input = await start;
    const recheck = f.collector.collect({
      account,
      window,
      now,
      recheckActivities: true,
    });
    expect(recheck).not.toBe(first);
    finish(fetched(input));
    await Promise.all([first, recheck]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("clears activity caches along with accounts", async () => {
    const f = fixture();
    await f.storage.transact((data) => ({
      ...data,
      activitySchedules: { [activityScheduleKey(schedule)]: schedule },
    }));
    const service = createAccountService(f.storage);
    expect((await service.clearAll()).activitySchedules).toEqual({});
  });
  it("drops corrupt optional cache data without losing accounts and reconstructs keys", async () => {
    const f = fixture();
    await f.area.set({
      "ojtrace:data": {
        ...defaultStoredData(),
        accounts: [account],
        activitySchedules: {
          arbitrary: schedule,
          bad: { ...schedule, checkedAt: "bad" },
        },
      },
    });
    expect((await f.storage.load()).activitySchedules).toEqual({
      [activityScheduleKey(schedule)]: schedule,
    });
    await f.area.set({
      "ojtrace:data": {
        ...defaultStoredData(),
        accounts: [account],
        activitySchedules: null,
      },
    });
    const state = await f.storage.load();
    expect(state.accounts).toEqual([account]);
    expect(state.activitySchedules).toEqual({});
  });
  it("drops discardable schedule cache on storage failure, preserving canonical data", async () => {
    const f = fixture();
    const set = vi.fn(f.area.set).mockRejectedValueOnce(new Error("quota"));
    const store = createStoragePort({ ...f.area, set });
    const result = await store.transact((data) => ({
      ...data,
      activitySchedules: { [activityScheduleKey(schedule)]: schedule },
    }));
    expect(set).toHaveBeenCalledTimes(2);
    expect(result.accounts).toEqual([account]);
    expect(result.activitySchedules).toEqual({});
  });
});
