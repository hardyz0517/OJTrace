import { describe, expect, it } from "vitest";
import { syncEnabledAccounts } from "../../src/application/sync/sync-service";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import type { HttpClient } from "../../src/domain";
import { accountRecord } from "../account-fixture";

function createFixture() {
  let value: Record<string, unknown> = {
    "ojtrace:data": {
      ...defaultStoredData(),
      accounts: [
        accountRecord({
          accountId: "account",
          source: "codeforces" as const,
          identifier: "tourist",
          enabled: true,
          authMode: "public-handle" as const,
        }),
      ],
    },
  };
  return {
    area: {
      get: async () => value,
      set: async (items: Record<string, unknown>) => {
        value = { ...value, ...items };
      },
    },
  };
}

describe("sync cancellation", () => {
  it("does not launch a second request for a duplicate in-flight account", async () => {
    const fixture = createFixture();
    const storage = createStoragePort(fixture.area);
    let calls = 0;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const http: HttpClient = {
      request: async () => {
        calls += 1;
        await wait;
        return {
          status: 200,
          url: "https://codeforces.com/api/user.status",
          contentType: "application/json",
          text: JSON.stringify({ status: "OK", result: [] }),
          headers: new Headers(),
        };
      },
    };
    const first = syncEnabledAccounts(storage, http, {
      force: true,
      now: 1_700_000_000_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = syncEnabledAccounts(storage, http, {
      force: true,
      now: 1_700_000_001_000,
    });
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });
});
