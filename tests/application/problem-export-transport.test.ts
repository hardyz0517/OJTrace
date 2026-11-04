import { describe, expect, it } from "vitest";
import {
  isProblemExportMessage,
  isProblemExportPortRequest,
  isProblemExportResponse,
  type ProblemExportFallbackJob,
} from "../../src/application/problem-export/messages";
import { createProblemExportConnectMessage } from "../../src/application/problem-export/transport";

const job: ProblemExportFallbackJob = {
  token: "a".repeat(64),
  tabId: 7,
  expectedUrl: "https://www.luogu.com.cn/problem/P1001",
  createdAt: 1_000,
  expiresAt: 301_000,
};

describe("problem export transport", () => {
  it.each(["PROBLEM_EXPORT_START", "PROBLEM_EXPORT_CANCEL"])(
    "rejects the retired port command %s",
    (type) => {
      expect(
        isProblemExportPortRequest({
          ...createProblemExportConnectMessage(job.token, job),
          type,
        }),
      ).toBe(false);
    },
  );

  it("requires a request id for the current connection handshake", () => {
    const message = createProblemExportConnectMessage(job.token, job);
    expect(
      isProblemExportPortRequest({ ...message, requestId: undefined }),
    ).toBe(false);
    expect(isProblemExportPortRequest({ ...message, requestId: "" })).toBe(
      false,
    );
  });

  it("accepts a recovery job in the connection handshake", () => {
    const message = createProblemExportConnectMessage(job.token, job);
    expect(isProblemExportPortRequest(message)).toBe(true);
    expect(message).toMatchObject({ token: job.token, job });
  });

  it("rejects malformed recovery metadata", () => {
    const message = createProblemExportConnectMessage(job.token, {
      ...job,
      expiresAt: job.createdAt,
    });
    expect(isProblemExportPortRequest(message)).toBe(false);
  });
});

describe("problem export responses", () => {
  it("accepts a failure response that has no type field", () => {
    expect(
      isProblemExportResponse({
        schemaVersion: 2,
        requestId: "req-1",
        ok: false,
        error: {
          code: "problem_export_failed",
          message: "当前页面无法读取，请切换到题目页后重试。",
        },
      }),
    ).toBe(true);
  });

  it("rejects a failure response without an error message", () => {
    expect(
      isProblemExportResponse({
        schemaVersion: 2,
        requestId: "req-1",
        ok: false,
        error: { code: "problem_export_failed" },
      }),
    ).toBe(false);
  });

  it("accepts extracted markdown and rejects an empty copy", () => {
    expect(
      isProblemExportMessage({
        schemaVersion: 2,
        requestId: "req-1",
        type: "EXTRACT_PROBLEM_MARKDOWN",
        tabId: 7,
        expectedUrl: "https://www.luogu.com.cn/problem/P1001",
      }),
    ).toBe(true);
    expect(
      isProblemExportResponse({
        schemaVersion: 2,
        requestId: "req-1",
        ok: true,
        type: "PROBLEM_MARKDOWN",
        markdown: "# P1001 A+B Problem\n\n计算。\n",
      }),
    ).toBe(true);
    expect(
      isProblemExportResponse({
        schemaVersion: 2,
        requestId: "req-1",
        ok: true,
        type: "PROBLEM_MARKDOWN",
        markdown: "   ",
      }),
    ).toBe(false);
  });

  it("rejects an unknown export intent", () => {
    const message = {
      schemaVersion: 2,
      requestId: "req-1",
      type: "START_PROBLEM_EXPORT",
      tabId: 7,
      expectedUrl: "https://www.luogu.com.cn/problem/P1001",
    };
    expect(isProblemExportMessage(message)).toBe(true);
    expect(isProblemExportMessage({ ...message, intent: "download" })).toBe(
      true,
    );
    expect(isProblemExportMessage({ ...message, intent: "edit" })).toBe(true);
    expect(isProblemExportMessage({ ...message, intent: "preview" })).toBe(
      false,
    );
    expect(isProblemExportMessage({ ...message, intent: "" })).toBe(false);
  });
});
