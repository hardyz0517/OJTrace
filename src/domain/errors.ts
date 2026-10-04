import type { AdapterError, AdapterErrorKind, SourceId } from "./types";

export class AdapterFailure extends Error {
  readonly error: AdapterError;

  constructor(error: AdapterError, options?: ErrorOptions) {
    super(error.messageKey, options);
    this.name = "AdapterFailure";
    this.error = error;
  }

  static fromTransport(
    error: unknown,
    source: SourceId,
    requestId: string,
  ): AdapterFailure {
    const code =
      error instanceof Error && "code" in error ? String(error.code) : "";
    const kind: AdapterErrorKind =
      code === "timeout"
        ? "timeout"
        : code === "rate_limited"
          ? "rate_limited"
          : code === "invalid_url"
            ? "invalid_response"
            : "network";
    return new AdapterFailure(
      {
        kind,
        source,
        stage: "request",
        messageKey:
          kind === "timeout"
            ? "source.timeout"
            : kind === "rate_limited"
              ? "source.rateLimited"
              : "source.networkError",
        retryable: kind === "network",
        userAction:
          kind === "timeout" || kind === "rate_limited"
            ? "retry_later"
            : undefined,
        ...(kind === "rate_limited"
          ? {
              httpStatus: 429,
              ...(error instanceof Error &&
              "retryAfterMs" in error &&
              typeof error.retryAfterMs === "number"
                ? { retryAfterMs: error.retryAfterMs }
                : {}),
            }
          : {}),
        requestId,
      },
      { cause: error },
    );
  }
}
