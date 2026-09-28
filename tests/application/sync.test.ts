import { describe, expect, it } from "vitest";
import { syncEnabledAccounts } from "../../src/application/sync/sync-service";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import type { HttpClient, StoredData } from "../../src/domain";

function area(initial: StoredData = defaultStoredData()) {
  let value: Record<string, unknown> = { "ojtrace:data": initial };
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
  authMode: "public" as const,
};

describe("sync application", () => {
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
          authMode: "browser_session" as const,
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
    expect(second.sources).toHaveLength(0);
  });
});
