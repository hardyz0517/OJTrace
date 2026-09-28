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
  });
});
