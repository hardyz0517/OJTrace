import { afterEach, describe, expect, it, vi } from "vitest";
import { isRuntimeResponse } from "../../src/application/messaging/response-guards";
import {
  authorizedResponse,
  browserSessionResponse,
  clearedResponse,
  dataResponse,
  responseError,
  syncResultResponse,
} from "../../src/application/messaging/responses";
import {
  createRuntimeMessage,
  sendRuntimeMessage,
} from "../../entrypoints/shared/runtime-client";
import { defaultStoredData } from "../../src/application/storage/store";
import { accountRecord } from "../account-fixture";

const account = accountRecord({
  accountId: "a",
  source: "qoj",
  providerAccountKey: "tester",
  authMode: "browser-session",
  enabled: true,
});
const stored = {
  ...defaultStoredData(),
  accounts: [account],
  credentials: [
    { accountId: "a", credentials: { cookie: "private-cookie" }, updatedAt: 1 },
  ],
};
const source = {
  accountId: "a",
  source: "qoj" as const,
  records: [],
  diagnostics: [],
  stale: true,
};
const sync = { data: stored, sources: [source], progress: [], addedRecords: 0 };
const requestId = "request";
afterEach(() => vi.unstubAllGlobals());

describe("runtime response boundary", () => {
  it.each([
    dataResponse(requestId, "STATE", stored),
    dataResponse(requestId, "UPDATED", stored),
    clearedResponse(requestId),
    authorizedResponse(requestId, { data: stored, account, superseded: true }),
    browserSessionResponse(requestId, "qoj", {
      authenticated: false,
      status: "unauthenticated",
    }),
    browserSessionResponse(requestId, "qoj", {
      authenticated: false,
      status: "unsupported",
    }),
    syncResultResponse(requestId, sync),
    responseError(requestId, "failed"),
  ])(
    "accepts every valid response branch including optional omissions",
    (response) => {
      expect(isRuntimeResponse(response)).toBe(true);
    },
  );
  it("retains partial coverage and rejects empty partial reasons", () => {
    const response = syncResultResponse(requestId, {
      ...sync,
      sources: [
        {
          ...source,
          coverage: {
            window: { since: 1, until: 2 },
            pagesFetched: 0,
            acceptedRecords: 0,
            outcome: { status: "partial", reasons: ["rate-limited"] },
          },
        },
      ],
    });
    expect(isRuntimeResponse(response)).toBe(true);
    const malformed = structuredClone(response);
    if (malformed.ok && malformed.type === "SYNC_RESULT")
      Object.assign(malformed.result.sources[0]!.coverage!.outcome, {
        reasons: [],
      });
    expect(isRuntimeResponse(malformed)).toBe(false);
  });
  it("removes credentials and internal activity caches without changing internal results", () => {
    const activitySchedules = [
      {
        source: "hydroj" as const,
        origin: "https://school.example.org",
        activityId: "000000000000000000000001",
        checkedAt: 1,
      },
    ];
    const result = { ...sync, sources: [{ ...source, activitySchedules }] };
    const response = syncResultResponse(requestId, result);
    expect(JSON.stringify(response)).not.toContain("private-cookie");
    expect(JSON.stringify(response)).not.toContain("activitySchedules");
    expect(result.sources[0]!.activitySchedules).toEqual(activitySchedules);
    if (response.ok && response.type === "SYNC_RESULT")
      expect(response.result.data.accounts[0]!.credentialConfigured).toBe(true);
  });
  it.each([
    { ...dataResponse(requestId, "STATE", stored), schemaVersion: 1 },
    { schemaVersion: 2, requestId, ok: true, type: "STATE", data: {} },
    { schemaVersion: 2, requestId, ok: false, error: { code: "failed" } },
    {
      schemaVersion: 2,
      requestId,
      ok: true,
      type: "BROWSER_SESSION",
      source: "qoj",
      account: { authenticated: false },
    },
    {
      ...syncResultResponse(requestId, sync),
      result: { ...sync, addedRecords: -1 },
    },
  ])("rejects malformed required fields", (response) =>
    expect(isRuntimeResponse(response)).toBe(false),
  );
  it("preserves an explicit id and accepts an error without a type field", async () => {
    const message = createRuntimeMessage({ type: "CLEAR_DATA" }, requestId);
    const reply = responseError(requestId, "failure");
    const send = vi.fn(async () => reply);
    vi.stubGlobal("browser", { runtime: { sendMessage: send } });
    expect(await sendRuntimeMessage(message)).toEqual(reply);
    expect(send).toHaveBeenCalledExactlyOnceWith(message);
  });
  it.each([
    dataResponse("wrong-id", "STATE", stored),
    dataResponse(requestId, "UPDATED", stored),
    undefined,
  ])("rejects wrong correlation/type without retry", async (response) => {
    const send = vi.fn(async () => response);
    vi.stubGlobal("browser", { runtime: { sendMessage: send } });
    await expect(
      sendRuntimeMessage(
        createRuntimeMessage({ type: "GET_STATE" }, requestId),
      ),
    ).rejects.toMatchObject({ name: "RuntimeClientError" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("classifies transport rejection without retrying a mutation", async () => {
    const cause = new Error("worker stopped");
    const send = vi.fn(async () => {
      throw cause;
    });
    vi.stubGlobal("browser", { runtime: { sendMessage: send } });
    await expect(
      sendRuntimeMessage(
        createRuntimeMessage({ type: "DELETE_ACCOUNT", accountId: "a" }),
      ),
    ).rejects.toMatchObject({ code: "transport", cause });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
