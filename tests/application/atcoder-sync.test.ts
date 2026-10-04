import { describe, expect, it } from "vitest";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import { createAccountCollector } from "../../src/application/sync/collect-account";
import { syncEnabledAccounts } from "../../src/application/sync/sync-service";
import { accountRecord } from "../account-fixture";
import type { AccountSyncProgress, HttpClient } from "../../src/domain";

describe("AtCoder synchronization completeness", () => {
  it("commits a two-record response as complete and updates success state despite optional detail failures", async () => {
    const account = accountRecord({
      accountId: "at",
      source: "atcoder",
      providerAccountKey: "Hardy_Zheng",
      enabled: true,
      authMode: "browser-session",
    });
    let value: Record<string, unknown> = {
      "ojtrace:data": {
        ...defaultStoredData(),
        accounts: [account],
        syncStates: { at: { stale: true } },
      },
    };
    const storage = createStoragePort({
      get: async () => value,
      set: async (update) => {
        value = { ...value, ...update };
      },
    });
    const http: HttpClient = {
      async request(_source, url) {
        const list = url.includes("user/submissions");
        return {
          url,
          status: list ? 200 : 403,
          contentType: "application/json",
          headers: new Headers(),
          text: JSON.stringify(
            list
              ? [25, 30].map((second, index) => ({
                  id: index + 1,
                  epoch_second: second,
                  contest_id: "abc1",
                  problem_id: "abc1_a",
                  language: "C++",
                  point: 100,
                  result: "AC",
                }))
              : {},
          ),
        };
      },
    };
    const collector = createAccountCollector(storage, http, {
      pagination: { runPage: ({ request }) => request() },
    });
    const updates: AccountSyncProgress[] = [];
    const result = await syncEnabledAccounts(
      storage,
      http,
      {
        force: true,
        now: 100_000,
        since: 20_000,
        until: 30_000,
        onProgress: (progress) => updates.push(progress),
      },
      collector,
    );
    expect(result.addedRecords).toBe(2);
    expect(result.data.submissions).toHaveLength(2);
    expect(result.data.syncStates.at).toMatchObject({
      stale: false,
      lastSuccessAt: 100_000,
    });
    expect(result.progress[0]).toMatchObject({
      status: "complete",
      recordsFetched: 2,
    });
    expect(updates.at(-1)?.status).toBe("complete");
    expect(result.sources[0]?.coverage?.outcome).toEqual({
      status: "complete",
      evidence: "exhausted",
    });
  });
});
