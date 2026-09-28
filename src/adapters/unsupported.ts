import type { OJAdapter } from "../domain";
import { AdapterFailure } from "../domain/errors";

export function createUnsupportedAdapter(
  source: "qoj" | "loj",
  displayName: string,
): OJAdapter {
  return {
    metadata: {
      id: source,
      displayName,
      availability: "unsupported",
      authModes: ["public", "browser_session"],
      capabilities: {
        accountLookup: false,
        stableSubmissionId: false,
        directSubmissionUrl: false,
        requiresBrowserSession: false,
        supportsAnonymous: false,
        supportsContentScriptFallback: false,
      },
    },
    async fetchRecent(input) {
      throw new AdapterFailure({
        kind: "unsupported",
        source,
        stage: "request",
        messageKey: `source.${source}.unsupported`,
        retryable: false,
        requestId: input.requestId,
      });
    },
  };
}

export const qojAdapter = createUnsupportedAdapter("qoj", "QOJ");
export const lojAdapter = createUnsupportedAdapter("loj", "LibreOJ");
