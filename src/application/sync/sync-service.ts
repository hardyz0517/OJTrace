import { adapterBySource } from "../../adapters";
import { AdapterFailure } from "../../domain/errors";
import { instanceBrandingKey } from "../../domain/account-identity";
import { mergeSubmissions } from "../../domain/merge";
import type {
  AccountConfig,
  AccountCredentials,
  AdapterError,
  Diagnostic,
  HttpClient,
  InstanceBrandingRecord,
  StoredData,
  Submission,
} from "../../domain";
import type { StoragePort } from "../storage/store";
import { refreshInstanceBranding } from "./instance-branding";
import { updateBrandingCache } from "../../domain/instance-branding";

export interface SyncSourceResult {
  accountId: string;
  source: AccountConfig["source"];
  records: Submission[];
  diagnostics: Diagnostic[];
  instanceBranding?: InstanceBrandingRecord;
  error?: AdapterError;
  stale: boolean;
}

export interface SyncResult {
  data: StoredData;
  sources: SyncSourceResult[];
}

const sourceRateLimitUntil = new Map<AccountConfig["source"], number>();
const SOURCE_COOLDOWN_MS = 2 * 60 * 1_000;
const MAX_LIMIT = 1_000;
const DEFAULT_SYNC_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;

interface InFlightSync {
  promise: Promise<SyncSourceResult>;
  controller: AbortController;
  credentialRevision?: number;
  since: number;
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
  credentials: AccountCredentials | undefined,
  existingBranding: InstanceBrandingRecord | undefined,
  http: HttpClient,
  now: number,
  since: number,
): Promise<SyncSourceResult> {
  const requestId = crypto.randomUUID();
  const adapter = adapterBySource.get(account.source);
  if (!adapter) {
    return {
      accountId: account.accountId,
      source: account.source,
      records: [],
      diagnostics: [],
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
  // A waiter holding an older snapshot must not cancel a newer credential run.
  if (
    existing &&
    (existing.credentialRevision ?? 0) > (account.credentialRevision ?? 0)
  )
    return existing.promise;
  if (existing && existing.credentialRevision === account.credentialRevision) {
    if (existing.since <= since) return existing.promise;
    // A wider requested window must not reuse a narrower running fetch.
    await existing.promise;
    return syncOne(account, credentials, existingBranding, http, now, since);
  }
  existing?.controller.abort();
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const result = await adapter.fetchRecent({
        account,
        credentials,
        limit: MAX_LIMIT,
        since,
        signal: controller.signal,
        now,
        requestId,
        http,
      });
      if (result.account.providerAccountKey !== account.providerAccountKey)
        throw new AdapterFailure({
          kind: "auth_required",
          source: account.source,
          stage: "identity",
          messageKey: "account.identityChanged",
          retryable: false,
          userAction: "edit_account",
          requestId,
        });
      let diagnostics = [...result.diagnostics];
      let instanceBranding = result.instanceMetadata?.branding;
      if (!instanceBranding) {
        const branding = await refreshInstanceBranding(
          adapter,
          {
            account,
            credentials,
            signal: controller.signal,
            now,
            requestId,
            http,
          },
          existingBranding,
        );
        diagnostics = diagnostics.concat(branding.diagnostics);
        instanceBranding = branding.branding;
      }
      return {
        accountId: account.accountId,
        source: account.source,
        records: result.records,
        diagnostics,
        instanceBranding,
        stale: false,
      };
    } catch (error) {
      return {
        accountId: account.accountId,
        source: account.source,
        records: [],
        diagnostics: [],
        stale: true,
        error: toError(error, account, requestId),
      };
    } finally {
      const active = inFlight.get(account.accountId);
      if (active?.controller === controller) inFlight.delete(account.accountId);
    }
  })();
  inFlight.set(account.accountId, {
    promise,
    controller,
    credentialRevision: account.credentialRevision,
    since,
  });
  return promise;
}

export async function syncEnabledAccounts(
  storage: StoragePort,
  http: HttpClient,
  options: {
    force: boolean;
    now?: number;
    since?: number;
    until?: number;
    accountIds?: string[];
  } = { force: false },
): Promise<SyncResult> {
  const now = options.now ?? Date.now();
  const since = options.since ?? now - DEFAULT_SYNC_LOOKBACK_MS;
  const until = options.until;
  const current = await storage.load();
  const selectedAccountIds =
    options.accountIds ?? current.preferences.syncAccountIds;
  const requestedAccountIds =
    options.accountIds === undefined && selectedAccountIds === undefined
      ? undefined
      : new Set(options.accountIds ?? selectedAccountIds ?? []);
  const accounts = current.accounts.filter(
    (account) =>
      account.enabled &&
      (selectedAccountIds === undefined ||
        selectedAccountIds.includes(account.accountId)) &&
      (!requestedAccountIds || requestedAccountIds.has(account.accountId)),
  );
  const eligible = accounts.filter((account) => {
    if ((sourceRateLimitUntil.get(account.source) ?? 0) > now) return false;
    if (options.force) return true;
    const state = current.syncStates[account.accountId];
    return (
      !state?.lastSuccessAt ||
      now - state.lastSuccessAt >= current.preferences.freshnessCooldownMs
    );
  });
  const sources = await Promise.all(
    eligible.map(async (account) => {
      const result = await syncOne(
        account,
        current.credentials.find((item) => item.accountId === account.accountId)
          ?.credentials,
        account.source === "hydroj" && account.origin
          ? current.instanceBranding[
              instanceBrandingKey(account.source, account.origin)
            ]
          : undefined,
        http,
        now,
        since,
      );
      return until === undefined
        ? result
        : {
            ...result,
            records: result.records.filter(
              (record) =>
                record.submittedAt >= since && record.submittedAt <= until,
            ),
          };
    }),
  );

  const result = await storage.transact((data) => {
    const accepted = sources.filter((item) => {
      const started = eligible.find(
        (account) => account.accountId === item.accountId,
      );
      const active = data.accounts.find(
        (account) => account.accountId === item.accountId,
      );
      return (
        active &&
        active.enabled &&
        active.credentialRevision === started?.credentialRevision
      );
    });
    const incoming = accepted.flatMap((item) => item.records);
    const submissions = mergeSubmissions(
      data.submissions,
      incoming,
      data.preferences.retentionPerAccount,
    );
    const syncStates = { ...data.syncStates };
    const brandings: InstanceBrandingRecord[] = [];
    for (const item of accepted) {
      const previous = syncStates[item.accountId];
      syncStates[item.accountId] = {
        stale: item.stale,
        lastAttemptAt: now,
        lastSuccessAt: item.stale ? previous?.lastSuccessAt : now,
        lastError: item.error,
      };
      if (item.instanceBranding) {
        try {
          instanceBrandingKey(item.source, item.instanceBranding.origin);
          brandings.push(item.instanceBranding);
        } catch {
          // Invalid metadata cannot make a successful submission sync fail.
        }
      }
    }
    return {
      ...data,
      submissions,
      syncStates,
      instanceBranding: updateBrandingCache(data.instanceBranding, brandings),
    };
  });
  const acceptedSources = sources.filter((item) => {
    const active = result.accounts.find(
      (account) => account.accountId === item.accountId,
    );
    const started = eligible.find(
      (account) => account.accountId === item.accountId,
    );
    return (
      active?.enabled &&
      active.credentialRevision === started?.credentialRevision
    );
  });
  for (const item of acceptedSources) {
    if (item.error?.kind === "rate_limited")
      sourceRateLimitUntil.set(item.source, now + SOURCE_COOLDOWN_MS);
  }
  return { data: result, sources: acceptedSources };
}
