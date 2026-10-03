import type {
  InstanceBrandingRecord,
  InstanceMetadataInput,
  Diagnostic,
  OJAdapter,
} from "../../domain";
import { instanceBrandingKey } from "../../domain/account-identity";

export const BRANDING_REFRESH_MS = 7 * 24 * 60 * 60 * 1_000;
type BrandingResult = {
  branding?: InstanceBrandingRecord;
  diagnostics: Diagnostic[];
};
const inFlight = new Map<string, Promise<BrandingResult>>();

export async function refreshInstanceBranding(
  adapter: OJAdapter,
  input: InstanceMetadataInput,
  current?: InstanceBrandingRecord,
): Promise<BrandingResult> {
  if (
    !adapter.fetchInstanceBranding ||
    !input.account.origin ||
    (current && input.now - current.fetchedAt < BRANDING_REFRESH_MS)
  )
    return { diagnostics: [] };
  const key = instanceBrandingKey(input.account.source, input.account.origin);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const operation = adapter
    .fetchInstanceBranding(input)
    .catch((): BrandingResult => ({
      diagnostics: [
        {
          source: input.account.source,
          code: "branding-unavailable",
          severity: "warning",
          messageKey: "source.brandingUnavailable",
          retryable: true,
        },
      ],
    }));
  inFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(key) === operation) inFlight.delete(key);
  }
}
