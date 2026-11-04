// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readCrossOjHistory,
  updateCrossOjEvaluation,
  upsertCrossOjHistory,
} from "../../src/oj-enhancer/features/cross-oj-submit/history";
import {
  atcoderEvaluationFromPage,
  classifyEvaluationText,
  codeforcesEvaluationFromPage,
  pollAndReportEvaluation,
} from "../../src/oj-enhancer/features/cross-oj-submit/evaluation";

const record = {
  oj: "codeforces" as const,
  submissionId: "123456",
  problemId: "1A",
  detailUrl: "https://codeforces.com/contest/1/submission/123456",
  observedAt: 100,
  evaluationStatus: "judging" as const,
  statusUpdatedAt: 100,
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("cross OJ submission history", () => {
  it("deduplicates by platform and submission ID and keeps only safe detail links", () => {
    const rows = readCrossOjHistory([
      record,
      { ...record, evaluationStatus: "accepted", statusUpdatedAt: 200 },
      { ...record, detailUrl: "https://evil.example/submission/123456" },
      { ...record, submissionId: "../../bad" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.evaluationStatus).toBe("accepted");
  });

  it("deduplicates repeated observations and preserves terminal verdicts", () => {
    const accepted = upsertCrossOjHistory([record], {
      ...record,
      evaluationStatus: "accepted",
      statusUpdatedAt: 200,
    });
    const refreshed = upsertCrossOjHistory(accepted, {
      ...record,
      statusUpdatedAt: 300,
    });
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.evaluationStatus).toBe("accepted");
  });

  it("caps local metadata history and does not persist source code", () => {
    const entries = Array.from({ length: 70 }, (_, index) => ({
      ...record,
      submissionId: String(1000 + index),
      detailUrl: `https://codeforces.com/contest/1/submission/${1000 + index}`,
      problemId: `1/${String.fromCharCode(65 + (index % 26))}`,
      observedAt: index,
      sourceCode: "must not persist",
    }));
    const history = readCrossOjHistory(entries);
    expect(history).toHaveLength(50);
    expect(history[0]?.observedAt).toBe(69);
    expect(JSON.stringify(history)).not.toContain("sourceCode");
  });

  it("updates only a matching submission detail and does not regress terminal status", () => {
    const accepted = updateCrossOjEvaluation([record], {
      detailUrl: record.detailUrl,
      submissionId: record.submissionId,
      evaluationStatus: "accepted",
      updatedAt: 200,
    });
    const regression = updateCrossOjEvaluation(accepted, {
      detailUrl: record.detailUrl,
      submissionId: record.submissionId,
      evaluationStatus: "judging",
      updatedAt: 300,
    });
    expect(regression?.[0]?.evaluationStatus).toBe("accepted");
    expect(
      updateCrossOjEvaluation([record], {
        detailUrl: "https://codeforces.com/contest/1/submission/other",
        submissionId: record.submissionId,
        evaluationStatus: "rejected",
        updatedAt: 300,
      }),
    ).toBeUndefined();
  });
});

describe("cross OJ verdict parsing and bounded polling", () => {
  it("recognizes explicit accepted/rejected/judging values and leaves unknown text unclassified", () => {
    expect(classifyEvaluationText("Accepted")).toBe("accepted");
    expect(classifyEvaluationText("Wrong answer")).toBe("rejected");
    expect(classifyEvaluationText("WJ")).toBe("judging");
    expect(classifyEvaluationText("Pending review by staff")).toBeUndefined();
  });

  it("reads only the known verdict field on each target detail page", () => {
    document.body.innerHTML = `
      <table><tr><td class="status-verdict-cell"><span class="verdict-accepted">Accepted</span></td></tr></table>
      <table><tr><th>結果</th><td><span>WJ</span></td></tr></table>
    `;
    expect(codeforcesEvaluationFromPage()).toBe("accepted");
    expect(atcoderEvaluationFromPage()).toBe("judging");
    document.body.innerHTML = `<p>Accepted text in a statement isn't a verdict.</p>`;
    expect(codeforcesEvaluationFromPage()).toBeUndefined();
    expect(atcoderEvaluationFromPage()).toBeUndefined();
  });

  it("runs a finite poll window without leaking a timer after a terminal verdict", async () => {
    const report = vi.fn(async () => true);
    await expect(
      pollAndReportEvaluation({
        readStatus: () => "accepted",
        report,
        onReported: vi.fn(),
        maxPolls: 20,
        intervalMs: 1000,
      }),
    ).resolves.toBe("accepted");
    expect(report).toHaveBeenCalledOnce();
  });

  it("marks an unrecognized status unknown after the bounded window", async () => {
    vi.useFakeTimers();
    const report = vi.fn(async () => true);
    const pending = pollAndReportEvaluation({
      readStatus: () => undefined,
      report,
      onReported: vi.fn(),
      maxPolls: 2,
      intervalMs: 1,
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("unknown");
    expect(report).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
