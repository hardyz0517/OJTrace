import { describe, expect, it } from "vitest";
import { isRuntimeMessage } from "../../src/application/messaging/messages";

describe("runtime message validation", () => {
  it("rejects forged or incomplete messages", () => {
    expect(isRuntimeMessage({ schemaVersion: 1, type: "GET_STATE" })).toBe(
      false,
    );
    expect(
      isRuntimeMessage({ schemaVersion: 1, type: "UNKNOWN", requestId: "x" }),
    ).toBe(false);
    expect(
      isRuntimeMessage({ schemaVersion: 2, type: "GET_STATE", requestId: "x" }),
    ).toBe(false);
  });

  it("accepts a versioned message with a request id", () => {
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "GET_STATE",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "AUTHORIZE_ACCOUNT",
        requestId: "request",
        source: "atcoder",
        authMode: "manual-cookie",
        credentials: { REVEL_SESSION: "session-token" },
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "CLEAR_ACCOUNTS",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "CLEAR_SUBMISSIONS",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "UPDATE_SYNC_ACCOUNTS",
        requestId: "request",
        accountIds: ["account-1", "account-2"],
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "SYNC_REQUEST",
        requestId: "request",
        force: true,
        accountIds: ["account-1"],
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "AUTHORIZE_ACCOUNT",
        requestId: "request",
        source: "luogu",
        authMode: "browser-session",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "AUTHORIZE_ACCOUNT",
        requestId: "request",
        source: "luogu",
        authMode: "manual-cookie",
        identifier: "123456",
        cookie: "__client_id=redacted",
      }),
    ).toBe(true);
  });

  it("rejects manual authorization without credentials", () => {
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "AUTHORIZE_ACCOUNT",
        requestId: "request",
        source: "luogu",
        authMode: "manual-cookie",
      }),
    ).toBe(false);
  });

  it("rejects malformed sync account selections", () => {
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "UPDATE_SYNC_ACCOUNTS",
        requestId: "request",
        accountIds: [""],
      }),
    ).toBe(false);
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "SYNC_REQUEST",
        requestId: "request",
        force: true,
        accountIds: [""],
      }),
    ).toBe(false);
    expect(
      isRuntimeMessage({
        schemaVersion: 1,
        type: "UPDATE_SYNC_ACCOUNTS",
        requestId: "request",
        accountIds: "account-1",
      }),
    ).toBe(false);
  });
});
