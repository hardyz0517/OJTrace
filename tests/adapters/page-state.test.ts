import { describe, expect, it } from "vitest";
import {
  DescendingWindowTracker,
  WindowRecordBuffer,
  PageSignatures,
  PageProgress,
  classifiedPageFailure,
} from "../../src/adapters/shared/page-state";
import { createAdapterFailure } from "../../src/domain/errors";
import type { Submission, CollectionProgress } from "../../src/domain";

const record = (
  id: string,
  submittedAt: number,
  problemName = id,
): Submission => ({
  source: "qoj",
  accountId: "a",
  submissionId: id,
  identityQuality: "stable",
  problemId: "1",
  problemName,
  submittedAt,
  fetchedAt: 100,
  verdict: { code: "accepted", raw: "AC" },
});
describe("normalized page rules", () => {
  it("observes all page records and never restores order trust after a reversal", () => {
    const order = new DescendingWindowTracker();
    expect(order.observe([record("1", 40), record("2", 30)], 20)).toEqual({
      validTimes: true,
      reachedSince: false,
    });
    expect(
      order.observe([record("3", 35), record("4", 10)], 20).reachedSince,
    ).toBe(false);
    expect(order.observe([record("5", 5)], 20).reachedSince).toBe(false);
    const invalid = new DescendingWindowTracker();
    expect(invalid.observe([record("1", NaN)], 20).validTimes).toBe(false);
    expect(invalid.observe([record("2", 10)], 20).reachedSince).toBe(false);
  });
  it("keeps inclusive endpoints, first occurrences and unique overflow without spending quota outside the window", () => {
    const buffer = new WindowRecordBuffer({ since: 20, until: 30 }, 2);
    expect(
      buffer.append([
        record("above", 31),
        record("upper", 30),
        record("upper", 25, "later"),
        record("lower", 20),
        record("below", 19),
      ]),
    ).toBe(false);
    expect(
      buffer.records.map(({ submissionId, problemName }) => [
        submissionId,
        problemName,
      ]),
    ).toEqual([
      ["upper", "upper"],
      ["lower", "lower"],
    ]);
    expect(buffer.append([record("overflow", 25)])).toBe(true);
    expect(buffer.append([record("overflow", 25)])).toBe(false);
    expect(
      new WindowRecordBuffer({ since: 20, until: 30 }, 1).append([
        record("upper", 30),
      ]),
    ).toBe(false);
  });
  it("distinguishes exact repeated pages, overlap, order and empty pages", () => {
    const pages = new PageSignatures();
    expect(
      ["", "", "1,2", "2,3", "2,1", "1,2"].map((signature) =>
        pages.repeated(signature),
      ),
    ).toEqual([false, false, false, false, false, true]);
  });
  it("counts dispatched logical pages and preserves source progress payload shape", () => {
    const updates: Partial<CollectionProgress>[] = [];
    const records: Submission[] = [];
    const progress = new PageProgress(
      (update) => updates.push(update),
      records,
      true,
    );
    progress.dispatched();
    records.push(record("a", 20));
    progress.report(5);
    expect(updates).toEqual([
      {
        phase: "list",
        pagesFetched: 1,
        recordsFetched: 0,
        pageEstimate: undefined,
      },
      { phase: "list", pagesFetched: 1, recordsFetched: 1, pageEstimate: 5 },
    ]);
  });
  it("preserves cancel/deadline/identity precedence even without accepted records", () => {
    const identity = createAdapterFailure("qoj", "request", {
      kind: "auth_required",
      stage: "identity",
      messageKey: "account.identityMismatch",
      retryable: false,
    });
    const controller = new AbortController();
    expect(() =>
      classifiedPageFailure(identity, controller.signal, 1, "qoj"),
    ).toThrow(identity);
    const deadline = { kind: "deadline" };
    controller.abort(deadline);
    expect(() =>
      classifiedPageFailure(identity, controller.signal, 0, "qoj"),
    ).toThrow(identity);
    expect(
      classifiedPageFailure(identity, controller.signal, 1, "qoj").diagnostic,
    ).toEqual({
      source: "qoj",
      code: "deadline",
      severity: "warning",
      messageKey: "sync.partial",
      retryable: true,
    });
    expect(
      classifiedPageFailure(new Error("unknown"), controller.signal, 1, "qoj")
        .reason,
    ).toBe("deadline");
    const cancelled = new AbortController();
    const cancellation = new Error("user cancelled");
    cancelled.abort(cancellation);
    expect(() =>
      classifiedPageFailure(identity, cancelled.signal, 1, "qoj"),
    ).toThrow(cancellation);
  });
  it("retains rate-limit message/retry policy after a successful page", () => {
    const rateLimit = createAdapterFailure("luogu", "request", {
      kind: "rate_limited",
      stage: "request",
      messageKey: "source.rateLimited",
      retryable: false,
      httpStatus: 429,
    });
    const signal = new AbortController().signal;
    expect(() => classifiedPageFailure(rateLimit, signal, 0, "luogu")).toThrow(
      rateLimit,
    );
    expect(classifiedPageFailure(rateLimit, signal, 1, "luogu")).toEqual({
      reason: "rate-limited",
      diagnostic: {
        source: "luogu",
        code: "rate-limited",
        severity: "warning",
        messageKey: "source.rateLimited",
        retryable: false,
      },
    });
  });
});
