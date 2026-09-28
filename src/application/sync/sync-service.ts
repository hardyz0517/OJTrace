import { adapterBySource } from "../../adapters";
import { AdapterFailure } from "../../domain/errors";
import { mergeSubmissions } from "../../domain/merge";
import type {
  AccountConfig,
  AdapterError,
  HttpClient,
  StoredData,
  Submission,
} from "../../domain";
import type { StoragePort } from "../storage/store";

export interface SyncSourceResult {
  accountId: string;
  source: AccountConfig["source"];
  records: Submission[];
  error?: AdapterError;
  stale: boolean;
}

export interface SyncResult {
  data: StoredData;
  sources: SyncSourceResult[];
}

const sourceRateLimitUntil = new Map<AccountConfig["source"], number>();
const SOURCE_COOLDOWN_MS = 2 * 60 * 1_000;

const MAX_LIMIT = 100;
interface InFlightSync {
  promise: Promise<SyncSourceResult>;
  controller: AbortController;
}

const inFlight = new Map<string, InFlightSync>();

function toError(
  error: unknown,
  account: AccountConfig,
  requestId: string,
): AdapterError {
  if (error instanceof AdapterFailure) return error.error;
  return {
    kind: "unknown",
    source: account.source,
    stage: "request",
    messageKey: "source.unknownError",
    retryable: false,
    requestId,
  };
}

async function syncOne(
  account: AccountConfig,
  http: HttpClient,
  now: number,
): Promise<SyncSourceResult> {
  const requestId = crypto.randomUUID();
  const adapter = adapterBySource.get(account.source);
  if (!adapter) {
    return {
      accountId: account.accountId,
      source: account.source,
      records: [],
      stale: true,
      error: {
        kind: "unsupported",
        source: account.source,
        stage: "request",
        messageKey: "source.unsupported",
        retryable: false,
        requestId,
      },
    };
  }

  const existing = inFlight.get(account.accountId);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const promise = (async () => {
    try {
      const result = await adapter.fetchRecent({
        account,
        limit: MAX_LIMIT,
        signal: controller.signal,
        now,
        requestId,
        http,
      });
      return {
        accountId: account.accountId,
        source: account.source,
        records: result.records,
        stale: false,
      };
    } catch (error) {
      return {
        accountId: account.accountId,
        source: account.source,
        records: [],
        stale: true,
        error: toError(error, account, requestId),
      };
    } finally {
      const active = inFlight.get(account.accountId);
      if (active?.controller === controller) {
        inFlight.delete(account.accountId);
      }
    }
  })();
  inFlight.set(account.accountId, { promise, controller });
  return promise;
}

export async function syncEnabledAccounts(
  storage: StoragePort,
  http: HttpClient,
  options: { force: boolean; now?: number } = { force: false },
): Promise<SyncResult> {
  const now = options.now ?? Date.now();
  const current = await storage.load();
  const accounts = current.accounts.filter((account) => account.enabled);
  const eligible = accounts.filter((account) => {
    if ((sourceRateLimitUntil.get(account.source) ?? 0) > now) return false;
    if (options.force) return true;
    const state = current.syncStates[account.accountId];
    return (
      !state?.lastSuccessAt ||
      now - state.lastSuccessAt >= current.preferences.freshnessCooldownMs
    );
  });
  if (options.force) {
    for (const account of eligible) {
      inFlight.get(account.accountId)?.controller.abort();
    }
  }
  const sources = await Promise.all(
    eligible.map((account) => syncOne(account, http, now)),
  );
  for (const item of sources) {
    if (item.error?.kind === "rate_limited") {
      sourceRateLimitUntil.set(item.source, now + SOURCE_COOLDOWN_MS);
    }
  }

  const result = await storage.update((data) => {
    const incoming = sources.flatMap((item) => item.records);
    const submissions = mergeSubmissions(
      data.submissions,
      incoming,
      data.preferences.retentionPerAccount,
    );
    const syncStates = { ...data.syncStates };
    for (const item of sources) {
      const previous = syncStates[item.accountId];
      syncStates[item.accountId] = {
        stale: item.stale,
        lastAttemptAt: now,
        lastSuccessAt: item.stale ? previous?.lastSuccessAt : now,
        lastError: item.error,
      };
    }
    return { ...data, submissions, syncStates };
  });

  return { data: result, sources };
}
