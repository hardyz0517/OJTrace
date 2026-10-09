import type { CoverageOutcome, SyncCoverage } from "./adapter";
import type { SyncWindow } from "./sync-range";

/** Central constructor keeps partial reasons immutable and duplicate-free. */
export function finalizeCoverage(
  window: SyncWindow,
  pagesFetched: number,
  acceptedRecords: number,
  outcome: CoverageOutcome,
): SyncCoverage {
  let normalizedOutcome = outcome;
  if (outcome.status === "partial") {
    const [first, ...rest] = [...new Set(outcome.reasons)];
    if (!first)
      throw new Error("Partial coverage requires at least one reason");
    normalizedOutcome = {
      status: "partial",
      reasons: Object.freeze([first, ...rest]),
    };
  }
  return {
    window: Object.freeze({ since: window.since, until: window.until }),
    pagesFetched: Math.max(0, Math.floor(pagesFetched)),
    acceptedRecords: Math.max(0, Math.floor(acceptedRecords)),
    outcome: normalizedOutcome,
  };
}
