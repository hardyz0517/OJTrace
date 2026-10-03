import type { CanonicalAccount, FetchInput, OJAdapter } from "../domain";

/** Reuse the provider's verified identity path without duplicating parsers. */
export async function authorizeFromRecent(
  adapter: OJAdapter,
  input: FetchInput,
): Promise<CanonicalAccount> {
  const result = await adapter.fetchRecent({
    ...input,
    limit: 1,
    since: undefined,
  });
  return result.account;
}
