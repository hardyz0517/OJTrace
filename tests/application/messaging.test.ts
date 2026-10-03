import { describe, expect, it } from "vitest";
import { isRuntimeMessage } from "../../src/application/messaging/messages";

describe("runtime message validation", () => {
  it("accepts collection ranges and rejects malformed ranges and reversed request bounds", () => {
    const message = {
      schemaVersion: 2,
      type: "UPDATE_SYNC_RANGE",
      requestId: "r",
    };
    expect(
      isRuntimeMessage({
        ...message,
        range: { from: 100, to: 200, followNow: true, preset: 7 },
      }),
    ).toBe(true);
    for (const range of [
      null,
      { from: 100, to: 90, followNow: false },
      { from: 100, to: Infinity, followNow: false },
      { from: 100, to: 200 },
      { from: 100, to: 200, followNow: false, preset: 365 },
    ]) {
      expect(isRuntimeMessage({ ...message, range })).toBe(false);
    }
    const sync = {
      schemaVersion: 2,
      type: "SYNC_REQUEST",
      requestId: "r",
      force: true,
      since: 100,
    };
    expect(isRuntimeMessage({ ...sync, until: 200 })).toBe(true);
    expect(isRuntimeMessage({ ...sync, until: 90 })).toBe(false);
    expect(isRuntimeMessage({ ...sync, until: NaN })).toBe(false);
  });

  it("rejects forged or incomplete messages", () => {
    expect(isRuntimeMessage({ schemaVersion: 2, type: "GET_STATE" })).toBe(
      false,
    );
    expect(
      isRuntimeMessage({ schemaVersion: 2, type: "UNKNOWN", requestId: "x" }),
    ).toBe(false);
    expect(
      isRuntimeMessage({ schemaVersion: 1, type: "GET_STATE", requestId: "x" }),
    ).toBe(false);
  });

  it("accepts a versioned message with a request id", () => {
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "GET_STATE",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "AUTHORIZE_ACCOUNT",
        requestId: "request",
        source: "luogu",
        authMode: "manual-cookie",
        credentials: { __client_id: "redacted", _uid: "123456" },
        cookie: "legacy-field",
      }),
    ).toBe(false);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "AUTHORIZE_ACCOUNT",
        requestId: "request",
        source: "atcoder",
        authMode: "manual-cookie",
        credentials: { REVEL_SESSION: "session-token" },
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "CLEAR_ACCOUNTS",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "CLEAR_SUBMISSIONS",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "UPDATE_SYNC_ACCOUNTS",
        requestId: "request",
        accountIds: ["account-1", "account-2"],
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "SYNC_REQUEST",
        requestId: "request",
        force: true,
        accountIds: ["account-1"],
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "AUTHORIZE_ACCOUNT",
        requestId: "request",
        source: "luogu",
        authMode: "browser-session",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "AUTHORIZE_ACCOUNT",
        requestId: "request",
        source: "luogu",
        authMode: "manual-cookie",
        credentials: { __client_id: "redacted", _uid: "123456" },
      }),
    ).toBe(true);
  });

  it("rejects manual authorization without credentials", () => {
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
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
        schemaVersion: 2,
        type: "UPDATE_SYNC_ACCOUNTS",
        requestId: "request",
        accountIds: [""],
      }),
    ).toBe(false);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "SYNC_REQUEST",
        requestId: "request",
        force: true,
        accountIds: [""],
      }),
    ).toBe(false);
    expect(
      isRuntimeMessage({
        schemaVersion: 2,
        type: "UPDATE_SYNC_ACCOUNTS",
        requestId: "request",
        accountIds: "account-1",
      }),
    ).toBe(false);
  });
});
