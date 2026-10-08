import { buildIdentityKey } from "../../domain/account-identity";
import type {
  AccountAuthMode,
  AccountConfig,
  AccountRecord,
  AccountCredentials,
  CanonicalAccount,
  CredentialRecord,
  InstanceBrandingRecord,
  StoredData,
  HttpClient,
  SourceId,
} from "../../domain";
import { adapterBySource } from "../../adapters";
import { createHydroOJInstance } from "../../adapters/hydroj/instance";
import { AccountCommandError } from "./account-errors";
import type { StoragePort } from "../storage/store";
import {
  accountCollectorFor,
  type AccountCollector,
} from "../sync/collect-account";
import { updateBrandingCache } from "../../domain/instance-branding";

export interface AuthorizedAccountInput {
  requested: AccountConfig;
  credentials?: AccountCredentials;
  canonical: CanonicalAccount;
  branding?: InstanceBrandingRecord;
  now: number;
}

export interface AccountService {
  authorize(command: AuthorizeAccountCommand): Promise<{
    data: StoredData;
    account: AccountRecord;
    superseded: boolean;
  }>;
  upsertAuthorized(input: AuthorizedAccountInput): Promise<{
    data: StoredData;
    account: AccountRecord;
  }>;
  remove(accountId: string): Promise<StoredData>;
  clearAll(): Promise<StoredData>;
  cancelPending(): void;
}

export interface AuthorizeAccountCommand {
  source: SourceId;
  authMode: AccountAuthMode;
  identifier?: string;
  label?: string;
  credentials?: AccountCredentials;
  origin?: string;
  domainId?: string;
  requestId: string;
}

export interface AccountServiceDependencies {
  http: HttpClient;
  ensurePermission(source: SourceId, origin?: string): Promise<boolean>;
  now?: () => number;
  collector?: AccountCollector;
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
  let authorizationSequence = 0;
  let authorizationGeneration = 0;
  const completedAuthorizations = new Map<string, number>();
  const service: AccountService = {
    async authorize(command) {
      if (!dependencies)
        throw new AccountCommandError("unsupported", "account.unavailable");
      const sequence = ++authorizationSequence;
      const generation = authorizationGeneration;
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
      let domainId: string | undefined;
      if (command.source === "hydroj") {
        try {
          ({ origin, domainId } = createHydroOJInstance(
            command.origin,
            command.domainId,
          ));
        } catch {
          throw new AccountCommandError(
            "invalid-origin",
            "account.invalidOrigin",
          );
        }
      } else if (command.origin !== undefined || command.domainId !== undefined)
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
        ...(command.source === "hydroj"
          ? { label: command.label?.trim() || "HydroOJ" }
          : {}),
        origin,
        ...(domainId === undefined ? {} : { domainId }),
        enabled: true,
      };
      const input = {
        account: requested,
        credentials,
        signal: new AbortController().signal,
        now,
        requestId: command.requestId,
        http: dependencies.http,
      };
      const canonical = await adapter.authorize(input);
      const identityKey = buildIdentityKey({
        source: canonical.source,
        origin: requested.origin,
        domainId: requested.domainId,
        providerAccountKey: canonical.providerAccountKey,
      });
      if (
        generation !== authorizationGeneration ||
        sequence < (completedAuthorizations.get(identityKey) ?? 0)
      )
        throw new AccountCommandError(
          "superseded",
          "account.operationSuperseded",
        );
      completedAuthorizations.set(identityKey, sequence);
      const saved = await service.upsertAuthorized({
        requested,
        credentials,
        canonical,
        now,
      });
      (
        dependencies.collector ??
        accountCollectorFor(storage, dependencies.http)
      ).invalidate(saved.account.accountId, saved.account.credentialRevision);
      const data = await storage.load();
      return {
        data,
        account:
          data.accounts.find(
            (item) => item.accountId === saved.account.accountId,
          ) ?? saved.account,
        superseded:
          generation !== authorizationGeneration ||
          !data.accounts.some(
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
          domainId: input.requested.domainId,
          providerAccountKey: input.canonical.providerAccountKey,
        });
        const existing = current.accounts.find(
          (item) => item.identityKey === identityKey,
        );
        const accountId = existing?.accountId ?? input.requested.accountId;
        account = {
          source: input.requested.source,
          authMode: input.requested.authMode,
          enabled: existing?.enabled ?? input.requested.enabled,
          ...(input.requested.origin ? { origin: input.requested.origin } : {}),
          ...(input.requested.domainId
            ? { domainId: input.requested.domainId }
            : {}),
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
          [accountId]: { ...current.syncStates[accountId], stale: true },
        };
        const instanceBranding = updateBrandingCache(
          current.instanceBranding,
          input.branding ? [input.branding] : [],
        );
        const data: StoredData = {
          ...current,
          accounts,
          credentials,
          syncStates,
          instanceBranding,
        };
        return data;
      });
      return { data, account };
    },

    async remove(accountId) {
      if (dependencies)
        (
          dependencies.collector ??
          accountCollectorFor(storage, dependencies.http)
        ).cancel(accountId);
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
      service.cancelPending();
      return storage.transact((current) => ({
        ...current,
        accounts: [],
        credentials: [],
        submissions: [],
        syncStates: {},
        instanceBranding: {},
        activitySchedules: {},
        preferences: { ...current.preferences, syncAccountIds: [] },
      }));
    },
    cancelPending() {
      authorizationGeneration += 1;
      if (dependencies)
        (
          dependencies.collector ??
          accountCollectorFor(storage, dependencies.http)
        ).cancelAll();
    },
  };
  return service;
}
