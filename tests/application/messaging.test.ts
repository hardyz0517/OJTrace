import { describe, expect, it } from "vitest";
import {
  isRuntimeMessage,
  isSyncProgressEvent,
} from "../../src/application/messaging/messages";

describe("runtime message validation", () => {
  it("validates source pagination patches and explicit default resets", () => {
    const message = {
      schemaVersion: 2,
      type: "UPDATE_PAGINATION_POLICY",
      requestId: "pagination",
      source: "qoj",
    };
    expect(
      isRuntimeMessage({
        ...message,
        policy: { intervalMs: 3_000, jitterMs: 1_000 },
      }),
    ).toBe(true);
    expect(isRuntimeMessage({ ...message, policy: null })).toBe(true);
    for (const policy of [
      undefined,
      {},
      [],
      { intervalMs: 0, jitterMs: 0 },
      { intervalMs: 1_500, jitterMs: 600 },
      { intervalMs: "1500", jitterMs: 500 },
      { intervalMs: 1_500, jitterMs: Infinity },
    ])
      expect(isRuntimeMessage({ ...message, policy })).toBe(false);
    expect(
      isRuntimeMessage({ ...message, source: "unknown", policy: null }),
    ).toBe(false);
  });
  it("accepts only a boolean full activity recheck flag", () => {
    const message = {
      schemaVersion: 2,
      type: "SYNC_REQUEST",
      requestId: "recheck",
      force: true,
    };
    for (const recheckActivities of [undefined, true, false])
      expect(isRuntimeMessage({ ...message, recheckActivities })).toBe(true);
    for (const recheckActivities of [null, "true", 1, {}])
      expect(isRuntimeMessage({ ...message, recheckActivities })).toBe(false);
  });
  it.each(["DETECT_BROWSER_SESSION", "AUTHORIZE_ACCOUNT"])(
    "validates Hydro domain ids at the %s boundary",
    (type) => {
      const message = {
        schemaVersion: 2,
        type,
        requestId: "scope",
        source: "hydroj",
        authMode: "browser-session",
      };
      expect(isRuntimeMessage({ ...message, domainId: "student" })).toBe(true);
      expect(isRuntimeMessage(message)).toBe(true);
      for (const domainId of [
        "",
        "a/b",
        "../root",
        "a?b",
        " student",
        "a".repeat(65),
        null,
        42,
      ])
        expect(isRuntimeMessage({ ...message, domainId })).toBe(false);
      expect(
        isRuntimeMessage({ ...message, source: "luogu", domainId: "student" }),
      ).toBe(false);
    },
  );

  it("validates progress events separately from commands and rejects invalid counters", () => {
    const event = {
      schemaVersion: 2,
      type: "SYNC_PROGRESS",
      requestId: "run",
      sequence: 1,
      progress: {
        accountId: "cf",
        source: "codeforces",
        phase: "list",
        status: "running",
        pagesFetched: 1,
        recordsFetched: 24,
      },
    };
    expect(isSyncProgressEvent(event)).toBe(true);
    expect(isRuntimeMessage(event)).toBe(false);
    for (const pagesFetched of [-1, Infinity, 1.5, "1"]) {
      expect(
        isSyncProgressEvent({
          ...event,
          progress: { ...event.progress, pagesFetched },
        }),
      ).toBe(false);
    }
    expect(
      isSyncProgressEvent({
        ...event,
        progress: { ...event.progress, diagnostics: {} },
      }),
    ).toBe(false);
    expect(isSyncProgressEvent({ ...event, sequence: -1 })).toBe(false);
    expect(
      isSyncProgressEvent({
        ...event,
        progress: { ...event.progress, status: "unknown" },
      }),
    ).toBe(false);
  });
  it("accepts an optional HydroOJ instance name and rejects malformed names", () => {
    const message = {
      schemaVersion: 2,
      type: "AUTHORIZE_ACCOUNT",
      requestId: "r",
      source: "hydroj",
      authMode: "browser-session",
      origin: "https://oj.example.org",
    };
    for (const label of [undefined, "", "学校 OJ"]) {
      expect(isRuntimeMessage({ ...message, label })).toBe(true);
    }
    for (const label of [null, 1, {}, "a\nb", "a".repeat(81)]) {
      expect(isRuntimeMessage({ ...message, label })).toBe(false);
    }
  });

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
