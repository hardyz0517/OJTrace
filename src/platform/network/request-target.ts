import type { HttpRequestOptions } from "../../domain/adapter";
import type { SourceId } from "../../domain/types";
import { sourceDefinitions } from "../../sources/definitions";

/** Snapshot the existing endpoint flag intersection for both URL boundaries. */
export function createRequestTargetPolicy(
  source: SourceId,
  options: HttpRequestOptions,
) {
  const fixed = sourceDefinitions[source].fixedOrigin;
  const origins = fixed ? [fixed] : [];
  if (source === "hydroj" && options.hydroOrigin)
    origins.push(options.hydroOrigin);
  else if (
    source === "atcoder" &&
    (options.atcoderProblemsApi ||
      options.atcoderProblemMetadataApi ||
      options.atcoderSubmissionPage)
  ) {
    origins.push(...(sourceDefinitions.atcoder.metadata.dataOrigins ?? []));
  }

  return {
    allows(raw: string): boolean {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return false;
      }
      if (
        (url.protocol !== "https:" &&
          !(source === "hydroj" && url.protocol === "http:")) ||
        url.username ||
        url.password ||
        !origins.some((origin) => url.origin === new URL(origin).origin)
      )
        return false;
      if (source !== "atcoder") return true;
      return (
        (!options.atcoderProblemsApi ||
          url.pathname.startsWith(
            "/atcoder/atcoder-api/v3/user/submissions",
          )) &&
        (!options.atcoderProblemMetadataApi ||
          url.pathname === "/atcoder/resources/problems.json") &&
        (!options.atcoderSubmissionPage ||
          /^\/contests\/[^/]+\/submissions\/\d+$/.test(url.pathname))
      );
    },
    /** Only original request options define credential scope; not response options. */
    allowsCredentials(raw: string): boolean {
      return (
        !options.atcoderSessionCookie ||
        (source === "atcoder" && new URL(raw).origin === fixed)
      );
    },
  };
}
