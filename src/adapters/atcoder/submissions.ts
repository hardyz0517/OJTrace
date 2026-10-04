import type { CoverageOutcome, FetchInput, PartialReason } from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { HttpClientError } from "../../platform/network/http-client";
import { reportProgress } from "../../domain/sync-progress";
import {
  classifySubmittedAt,
  isCollectionDeadline,
} from "../shared/submission-window";
import { parseAtCoderSubmissions, type AtCoderRawSubmission } from "./parser";
import { ATCODER_PROBLEMS_ORIGIN, atcoderUserSubmissionsUrl } from "./urls";

// Upstream SQL uses epoch_second >= from_second, ASC time order, LIMIT 500.
const BATCH_SIZE = 500;
const MAX_PAGES = 100;

function failure(
  input: FetchInput,
  kind:
    "auth_required" | "blocked" | "rate_limited" | "network" | "parse_failed",
  messageKey: string,
  httpStatus?: number,
): AdapterFailure {
  return new AdapterFailure({
    kind,
    source: "atcoder",
    stage: kind === "parse_failed" ? "parse" : "request",
    messageKey,
    retryable:
      kind === "network" && (httpStatus === undefined || httpStatus >= 500),
    httpStatus,
    userAction:
      kind === "auth_required"
        ? "open_site_login"
        : kind === "blocked" || kind === "rate_limited"
          ? "retry_later"
          : undefined,
    requestId: input.requestId,
  });
}

async function requestBatch(
  input: FetchInput,
  handle: string,
  fromSecond: number,
): Promise<AtCoderRawSubmission[]> {
  let response;
  try {
    response = await input.http.request(
      "atcoder",
      atcoderUserSubmissionsUrl(handle, fromSecond),
      {
        credentials: "omit",
        atcoderProblemsApi: true,
        signal: input.signal,
        headers: { Accept: "application/json" },
      },
    );
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason;
    throw AdapterFailure.fromTransport(error, "atcoder", input.requestId);
  }
  if (
    response.status === 401 ||
    /Sign In|ログイン|login\?continue/i.test(response.text)
  )
    throw failure(
      input,
      "auth_required",
      "source.authRequired",
      response.status,
    );
  if (response.status === 403)
    throw failure(input, "blocked", "source.blocked", response.status);
  if (response.status === 429)
    throw failure(input, "rate_limited", "source.rateLimited", response.status);
  if (response.status < 200 || response.status >= 300)
    throw failure(input, "network", "source.httpError", response.status);
  try {
    return parseAtCoderSubmissions(response.text);
  } catch {
    throw failure(input, "parse_failed", "source.invalidResponse");
  }
}

export async function collectAtCoderSubmissions(
  input: FetchInput,
  handle: string,
): Promise<{
  rows: AtCoderRawSubmission[];
  pagesFetched: number;
  outcome: CoverageOutcome;
}> {
  const selected = new Map<string, AtCoderRawSubmission>();
  const maxRecords = Math.max(1, Math.min(input.limit, 1_000));
  let cursor = Math.floor(input.since / 1_000);
  let pagesFetched = 0;
  let successfulPages = 0;
  const partial = (reason: PartialReason): CoverageOutcome => ({
    status: "partial",
    reasons: [reason],
  });
  let outcome: CoverageOutcome = partial("page-limit");

  while (pagesFetched < MAX_PAGES) {
    let raw: AtCoderRawSubmission[];
    try {
      raw = await input.pagination.runPage({
        origin: ATCODER_PROBLEMS_ORIGIN,
        signal: input.signal,
        request: () => {
          pagesFetched += 1;
          reportProgress(input.onProgress, {
            phase: "list",
            pagesFetched,
            recordsFetched: selected.size,
          });
          return requestBatch(input, handle, cursor);
        },
      });
      successfulPages += 1;
    } catch (error) {
      if (input.signal.aborted) {
        if (!successfulPages || !isCollectionDeadline(input.signal))
          throw input.signal.reason;
        outcome = partial("deadline");
      } else {
        const classified =
          error instanceof HttpClientError
            ? AdapterFailure.fromTransport(error, "atcoder", input.requestId)
            : error;
        if (!successfulPages || !(classified instanceof AdapterFailure))
          throw classified;
        outcome = partial(
          classified.error.kind === "rate_limited"
            ? "rate-limited"
            : "unavailable",
        );
      }
      break;
    }

    let previousSecond = cursor;
    let validTimes = true;
    let ordered = true;
    let afterWindow = false;
    let truncated = false;
    for (const item of raw) {
      const position = classifySubmittedAt(item.epochSecond * 1_000, input);
      if (!Number.isSafeInteger(item.epochSecond) || position === "invalid") {
        validTimes = false;
        continue;
      }
      if (item.epochSecond < previousSecond) ordered = false;
      previousSecond = item.epochSecond;
      if (position === "after") afterWindow = true;
      if (position !== "in-window" || selected.has(item.id)) continue;
      if (selected.size >= maxRecords) truncated = true;
      else selected.set(item.id, item);
    }
    reportProgress(input.onProgress, {
      phase: "list",
      pagesFetched,
      recordsFetched: selected.size,
    });
    if (truncated) {
      outcome = partial("record-limit");
      break;
    }
    if (!validTimes) {
      outcome = partial("invalid-record");
      break;
    }
    if (!ordered || raw.length > BATCH_SIZE) {
      outcome = partial("unverified-coverage");
      break;
    }
    if (afterWindow) {
      outcome = { status: "complete", evidence: "window-boundary" };
      break;
    }
    if (raw.length < BATCH_SIZE) {
      outcome = { status: "complete", evidence: "exhausted" };
      break;
    }
    const lastSecond = raw.at(-1)!.epochSecond;
    // Re-read the inclusive last second so a batch boundary cannot skip ties.
    // A full batch at one second cannot advance safely using this API.
    if (lastSecond <= cursor) {
      outcome = partial("unverified-coverage");
      break;
    }
    if (selected.size >= maxRecords) {
      outcome = partial("record-limit");
      break;
    }
    cursor = lastSecond;
  }
  return {
    rows: [...selected.values()].sort(
      (left, right) => right.epochSecond - left.epochSecond,
    ),
    pagesFetched,
    outcome,
  };
}
