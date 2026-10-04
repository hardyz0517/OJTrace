import { describe, expect, it, vi } from "vitest";
import { syncEnabledAccounts } from "../../src/application/sync/sync-service";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import type { HttpClient, StoredData, AccountConfig } from "../../src/domain";
import { createHttpClient } from "../../src/platform/network/http-client";
import { createRateLimitRegistry } from "../../src/platform/network/rate-limit";
import { accountRecord } from "../account-fixture";

function area(
  initial: Omit<StoredData, "accounts"> & {
    accounts: AccountConfig[];
  } = defaultStoredData(),
) {
  let value: Record<string, unknown> = {
    "ojtrace:data": {
      ...initial,
      accounts: initial.accounts.map(accountRecord),
    },
  };
  return {
    get: async () => value,
    set: async (items: Record<string, unknown>) => {
      value = { ...value, ...items };
    },
  };
}

const codeforcesAccount = {
  accountId: "cf-account",
  source: "codeforces" as const,
  identifier: "tourist",
  enabled: true,
  authMode: "public-handle" as const,
};

describe("sync application", () => {
  it("collects only the requested window and retains cached records outside it", async () => {
    const storage = createStoragePort(
      area({ ...defaultStoredData(), accounts: [codeforcesAccount] }),
    );
    const http: HttpClient = {
      async request() {
        return {
          status: 200,
          url: "https://codeforces.com/api/user.status",
          contentType: "application/json",
          headers: new Headers(),
          text: JSON.stringify({
            status: "OK",
            result: [0, 1, 2, 3].map((offset) => ({
              id: 42 + offset,
              contestId: 1,
              creationTimeSeconds: 1_700_000_000 - offset,
              problem: { contestId: 1, index: "A", name: "A+B" },
              verdict: "OK",
            })),
          }),
        };
      },
    };
    const now = 1_700_000_001_000;
    const initial = await syncEnabledAccounts(storage, http, {
      force: true,
      now,
    });
    expect(initial.data.submissions).toHaveLength(4);
    const result = await syncEnabledAccounts(storage, http, {
      force: true,
      now,
      since: 1_699_999_998_000,
      until: 1_699_999_999_000,
    });
    expect(
      result.sources[0]?.records.map((record) => record.submissionId),
    ).toEqual(["43", "44"]);
    expect(result.data.submissions).toHaveLength(4);
  });

  it("syncs only the persisted account selection", async () => {
    const otherAccount = {
      accountId: "luogu-account",
      source: "luogu" as const,
      identifier: "10001",
      enabled: true,
      authMode: "browser-session" as const,
    };
    const storage = createStoragePort(
      area({
        ...defaultStoredData(),
        accounts: [codeforcesAccount, otherAccount],
        preferences: {
          ...defaultStoredData().preferences,
          syncAccountIds: [codeforcesAccount.accountId],
        },
      }),
    );
    const requestedSources: string[] = [];
    const http: HttpClient = {
      async request(source) {
        requestedSources.push(source);
        return {
          status: 200,
          url:
            source === "luogu"
              ? "https://www.luogu.com.cn/record/list"
              : "https://codeforces.com/api/user.status",
          contentType: "application/json",
          text: JSON.stringify({ status: "OK", result: [] }),
          headers: new Headers(),
        };
      },
    };

    const result = await syncEnabledAccounts(storage, http, {
      force: true,
      now: 1_700_000_000_000,
    });
    expect(requestedSources).toEqual(["codeforces"]);
    expect(result.sources.map((item) => item.accountId)).toEqual([
      codeforcesAccount.accountId,
    ]);
  });

  it("honors an explicit request selection over persisted ids", async () => {
    const storage = createStoragePort(
      area({
        ...defaultStoredData(),
        accounts: [codeforcesAccount],
        preferences: {
          ...defaultStoredData().preferences,
          syncAccountIds: [codeforcesAccount.accountId],
        },
      }),
    );
    let calls = 0;
    const http: HttpClient = {
      async request() {
        calls += 1;
        throw new Error("should not request an unselected account");
      },
    };

    const result = await syncEnabledAccounts(storage, http, {
      force: true,
      accountIds: [],
      now: 1_700_000_000_000,
    });
    expect(calls).toBe(0);
    expect(result.sources).toHaveLength(0);
  });

  it("does not sync any account when persisted selection is empty", async () => {
    const storage = createStoragePort(
      area({
        ...defaultStoredData(),
        accounts: [codeforcesAccount],
        preferences: {
          ...defaultStoredData().preferences,
          syncAccountIds: [],
        },
      }),
    );
    const http: HttpClient = {
      async request() {
        throw new Error("should not request with an empty selection");
      },
    };
    const result = await syncEnabledAccounts(storage, http, { force: true });
    expect(result.sources).toHaveLength(0);
  });

  it("keeps successful records when another source fails", async () => {
    const initial = {
      ...defaultStoredData(),
      accounts: [
        codeforcesAccount,
        {
          accountId: "luogu-account",
          source: "luogu" as const,
          identifier: "123",
          enabled: true,
          authMode: "browser-session" as const,
        },
      ],
    };
    const storage = createStoragePort(area(initial));
    let calls = 0;
    const http: HttpClient = {
      async request(source) {
        calls += 1;
        if (source === "luogu") {
          return {
            status: 401,
            url: "https://www.luogu.com.cn/record/list",
            contentType: "application/json",
            text: JSON.stringify({ errorCode: 401 }),
            headers: new Headers(),
          };
        }
        return {
          status: 200,
          url: "https://codeforces.com/api/user.status",
          contentType: "application/json",
          text: JSON.stringify({
            status: "OK",
            result: [
              {
                id: 42,
                contestId: 1,
                creationTimeSeconds: 1_700_000_000,
                problem: { contestId: 1, index: "A", name: "A+B" },
                verdict: "OK",
              },
            ],
          }),
          headers: new Headers(),
        };
      },
    };

    const result = await syncEnabledAccounts(storage, http, {
      force: true,
      now: 1_700_000_001_000,
    });
    expect(calls).toBe(2);
    expect(result.data.submissions).toHaveLength(1);
    expect(
      result.sources.find((item) => item.source === "codeforces")?.stale,
    ).toBe(false);
    expect(
      result.sources.find((item) => item.source === "luogu")?.error?.kind,
    ).toBe("auth_required");
    expect(result.data.syncStates["luogu-account"]?.stale).toBe(true);
  });

  it("honors the freshness cooldown unless forced", async () => {
    const storage = createStoragePort(
      area({ ...defaultStoredData(), accounts: [codeforcesAccount] }),
    );
    let calls = 0;
    const http: HttpClient = {
      async request() {
        calls += 1;
        return {
          status: 200,
          url: "https://codeforces.com/api/user.status",
          contentType: "application/json",
          text: JSON.stringify({ status: "OK", result: [] }),
          headers: new Headers(),
        };
      },
    };
    await syncEnabledAccounts(storage, http, {
      force: true,
      now: 1_700_000_000_000,
    });
    const second = await syncEnabledAccounts(storage, http, {
      force: false,
      now: 1_700_000_001_000,
    });
    expect(calls).toBe(1);
    expect(second.sources[0]?.skipped).toBe("freshness");
  });

  it("does not immediately retry a rate-limited source", async () => {
    const storage = createStoragePort(
      area({ ...defaultStoredData(), accounts: [codeforcesAccount] }),
    );
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 429 }));
    const http = createHttpClient({ rateLimits: createRateLimitRegistry() });
    const first = await syncEnabledAccounts(storage, http, {
      force: true,
      now: 1_700_000_000_000,
    });
    const second = await syncEnabledAccounts(storage, http, {
      force: true,
      now: 1_700_000_001_000,
    });
    expect(first.sources[0]?.error?.kind).toBe("rate_limited");
    expect(second.sources[0]?.error?.kind).toBe("rate_limited");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRestore();
  });
});
