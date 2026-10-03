import { buildIdentityKey } from "../../domain/account-identity";
import { mergeSubmissions } from "../../domain/merge";
import type {
  AccountAuthMode,
  AccountConfig,
  AccountRecord,
  AccountCredentials,
  CanonicalAccount,
  CredentialRecord,
  InstanceBrandingRecord,
  Submission,
  StoredData,
  HttpClient,
  SourceId,
  AdapterError,
  Diagnostic,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { adapterBySource } from "../../adapters";
import { createHydroOJInstance } from "../../adapters/hydroj/instance";
import { AccountCommandError } from "./account-errors";
import type { StoragePort } from "../storage/store";
import { refreshInstanceBranding } from "../sync/instance-branding";
import { updateBrandingCache } from "../../domain/instance-branding";
import { instanceBrandingFor } from "./account-queries";

export interface AuthorizedAccountInput {
  requested: AccountConfig;
  credentials?: AccountCredentials;
  canonical: CanonicalAccount;
  records?: Submission[];
  branding?: InstanceBrandingRecord;
  now: number;
}

export interface AccountService {
  authorize(command: AuthorizeAccountCommand): Promise<{
    data: StoredData;
    account: AccountRecord;
    syncError?: AdapterError;
    diagnostics: Diagnostic[];
    superseded: boolean;
  }>;
  upsertAuthorized(input: AuthorizedAccountInput): Promise<{
    data: StoredData;
    account: AccountRecord;
  }>;
  remove(accountId: string): Promise<StoredData>;
  clearAll(): Promise<StoredData>;
}

export interface AuthorizeAccountCommand {
  source: SourceId;
  authMode: AccountAuthMode;
  identifier?: string;
  credentials?: AccountCredentials;
  origin?: string;
  requestId: string;
}

export interface AccountServiceDependencies {
  http: HttpClient;
  ensurePermission(source: SourceId, origin?: string): Promise<boolean>;
  now?: () => number;
}

function credentialRecord(
  accountId: string,
  credentials: AccountCredentials | undefined,
  updatedAt: number,
): CredentialRecord | undefined {
  if (!credentials || Object.keys(credentials).length === 0) return undefined;
  return { accountId, credentials: { ...credentials }, updatedAt };
}

export function createAccountService(
  storage: StoragePort,
  dependencies?: AccountServiceDependencies,
): AccountService {
  const service: AccountService = {
    async authorize(command) {
      if (!dependencies)
        throw new AccountCommandError("unsupported", "account.unavailable");
      const adapter = adapterBySource.get(command.source);
      const mode = adapter?.metadata.authModes.find(
        (item) => item.type === command.authMode,
      );
      if (!adapter || !mode)
        throw new AccountCommandError(
          "unsupported",
          "account.authModeUnsupported",
        );
      const identifier = command.identifier?.trim();
      if (
        mode.identifierRequired !== false &&
        command.authMode !== "browser-session" &&
        !identifier
      )
        throw new AccountCommandError(
          "invalid-input",
          "account.identifierRequired",
        );
      const fields = mode.credentialFields ?? [];
      if (
        Object.keys(command.credentials ?? {}).some(
          (key) => !fields.some((field) => field.key === key),
        )
      )
        throw new AccountCommandError(
          "invalid-input",
          "account.credentialsInvalid",
        );
      const credentials =
        command.authMode === "browser-session" ||
        command.authMode === "public-handle"
          ? undefined
          : Object.fromEntries(
              fields.flatMap((field) => {
                const value = command.credentials?.[field.key];
                if (field.required !== false && !value?.trim())
                  throw new AccountCommandError(
                    "invalid-input",
                    "account.credentialsRequired",
                  );
                return value ? [[field.key, value]] : [];
              }),
            );
      let origin: string | undefined;
      if (command.source === "hydroj") {
        try {
          origin = createHydroOJInstance(command.origin).origin;
        } catch {
          throw new AccountCommandError(
            "invalid-origin",
            "account.invalidOrigin",
          );
        }
      } else if (command.origin !== undefined)
        throw new AccountCommandError(
          "invalid-origin",
          "account.invalidOrigin",
        );
      if (!(await dependencies.ensurePermission(command.source, origin)))
        throw new AccountCommandError(
          "permission-denied",
          "account.permissionRequired",
        );
      const now = dependencies.now?.() ?? Date.now();
      const requested: AccountConfig = {
        accountId: crypto.randomUUID(),
        source: command.source,
        authMode: command.authMode,
        identifier,
        origin,
        enabled: false,
      };
      const input = {
        account: requested,
        credentials,
        limit: 1_000,
        since: now - 30 * 24 * 60 * 60 * 1_000,
        signal: new AbortController().signal,
        now,
        requestId: command.requestId,
        http: dependencies.http,
      };
      const canonical = await adapter.authorize(input);
      const saved = await service.upsertAuthorized({
        requested,
        credentials,
        canonical,
        now,
      });
      let records: Submission[] = [];
      let branding: InstanceBrandingRecord | undefined;
      let syncError: AdapterError | undefined;
      let diagnostics: Diagnostic[] = [];
      try {
        const fetched = await adapter.fetchRecent({
          ...input,
          account: saved.account,
        });
        if (fetched.account.providerAccountKey !== canonical.providerAccountKey)
          throw new AdapterFailure({
            kind: "auth_required",
            source: command.source,
            stage: "identity",
            messageKey: "account.identityChanged",
            retryable: false,
            userAction: "edit_account",
            requestId: command.requestId,
          });
        records = fetched.records;
        diagnostics = fetched.diagnostics;
        if (adapter.fetchInstanceBranding) {
          try {
            const refreshed = await refreshInstanceBranding(
              adapter,
              {
                ...input,
                account: saved.account,
              },
              instanceBrandingFor(saved.data, saved.account),
            );
            branding = refreshed.branding;
            diagnostics = diagnostics.concat(refreshed.diagnostics);
          } catch {
            /* Optional cache cannot invalidate records. */
          }
        }
      } catch (error) {
        syncError =
          error instanceof AdapterFailure
            ? error.error
            : {
                kind: "unknown",
                source: command.source,
                stage: "request",
                messageKey: "source.unknownError",
                retryable: false,
                requestId: command.requestId,
              };
      }
      const data = await storage.transact((current) => {
        const active = current.accounts.find(
          (item) => item.accountId === saved.account.accountId,
        );
        if (
          !active ||
          active.credentialRevision !== saved.account.credentialRevision
        )
          return current;
        const account = { ...active, enabled: !syncError };
        return {
          ...current,
          accounts: current.accounts.map((item) =>
            item.accountId === active.accountId ? account : item,
          ),
          submissions: mergeSubmissions(
            current.submissions,
            records,
            current.preferences.retentionPerAccount,
          ),
          syncStates: {
            ...current.syncStates,
            [active.accountId]: {
              stale: Boolean(syncError),
              lastAttemptAt: now,
              lastSuccessAt: syncError
                ? current.syncStates[active.accountId]?.lastSuccessAt
                : now,
              lastError: syncError,
            },
          },
          instanceBranding: updateBrandingCache(
            current.instanceBranding,
            branding ? [branding] : [],
          ),
        };
      });
      return {
        data,
        account:
          data.accounts.find(
            (item) => item.accountId === saved.account.accountId,
          ) ?? saved.account,
        syncError,
        diagnostics,
        superseded: !data.accounts.some(
          (item) =>
            item.accountId === saved.account.accountId &&
            item.credentialRevision === saved.account.credentialRevision,
        ),
      };
    },
    async upsertAuthorized(input) {
      let account!: AccountRecord;
      const data = await storage.transact((current) => {
        const identityKey = buildIdentityKey({
          source: input.canonical.source,
          origin: input.requested.origin,
          providerAccountKey: input.canonical.providerAccountKey,
        });
        const existing = current.accounts.find(
          (item) => item.identityKey === identityKey,
        );
        const accountId = existing?.accountId ?? input.requested.accountId;
        account = {
          source: input.requested.source,
          authMode: input.requested.authMode,
          enabled: input.requested.enabled,
          ...(input.requested.origin ? { origin: input.requested.origin } : {}),
          ...((input.requested.label ?? existing?.label)
            ? { label: input.requested.label ?? existing?.label }
            : {}),
          accountId,
          providerAccountKey: input.canonical.providerAccountKey,
          providerDisplayName: input.canonical.displayName,
          identityKey,
          verifiedAt: input.now,
          createdAt: existing?.createdAt ?? input.now,
          updatedAt: input.now,
          credentialRevision: (existing?.credentialRevision ?? 0) + 1,
        };
        const accounts = [
          ...current.accounts.filter((item) => item.accountId !== accountId),
          account,
        ];
        const credentials = current.credentials.filter(
          (item) => item.accountId !== accountId,
        );
        const record = credentialRecord(
          accountId,
          input.credentials,
          input.now,
        );
        if (record) credentials.push(record);
        const syncStates = {
          ...current.syncStates,
          [accountId]: {
            stale: input.records === undefined,
            ...(input.records === undefined
              ? {}
              : { lastAttemptAt: input.now, lastSuccessAt: input.now }),
          },
        };
        const instanceBranding = updateBrandingCache(
          current.instanceBranding,
          input.branding ? [input.branding] : [],
        );
        const data: StoredData = {
          ...current,
          accounts,
          credentials,
          submissions: input.records
            ? mergeSubmissions(
                current.submissions,
                input.records.map((item) => ({ ...item, accountId })),
                current.preferences.retentionPerAccount,
              )
            : current.submissions,
          syncStates,
          instanceBranding,
        };
        return data;
      });
      return { data, account };
    },

    async remove(accountId) {
      return storage.transact((current) => ({
        ...current,
        accounts: current.accounts.filter(
          (item) => item.accountId !== accountId,
        ),
        credentials: current.credentials.filter(
          (item) => item.accountId !== accountId,
        ),
        submissions: current.submissions.filter(
          (item) => item.accountId !== accountId,
        ),
        syncStates: Object.fromEntries(
          Object.entries(current.syncStates).filter(([id]) => id !== accountId),
        ),
        preferences: {
          ...current.preferences,
          ...(current.preferences.syncAccountIds
            ? {
                syncAccountIds: current.preferences.syncAccountIds.filter(
                  (id) => id !== accountId,
                ),
              }
            : {}),
        },
      }));
    },

    async clearAll() {
      return storage.transact((current) => ({
        ...current,
        accounts: [],
        credentials: [],
        submissions: [],
        syncStates: {},
        instanceBranding: {},
        preferences: { ...current.preferences, syncAccountIds: [] },
      }));
    },
  };
  return service;
}
