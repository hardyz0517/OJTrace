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
        : code === "invalid_url"
          ? "invalid_response"
          : "network";
    return new AdapterFailure(
      {
        kind,
        source,
        stage: "request",
        messageKey:
          kind === "timeout" ? "source.timeout" : "source.networkError",
        retryable: kind === "network",
        userAction: kind === "timeout" ? "retry_later" : undefined,
        requestId,
      },
      { cause: error },
    );
  }
}
