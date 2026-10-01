import type { OJAdapter } from "../domain";
import { AdapterFailure } from "../domain/errors";

export function createUnsupportedAdapter(
  source: never,
  displayName: string,
): OJAdapter {
  return {
    metadata: {
      id: source,
      displayName,
      availability: "unsupported",
      // No current submission-history implementation exists for these OJs.
      // Do not advertise an auth mode that would imply sync support.
      authModes: [],
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
