import {
  DEFAULT_PREFERENCES,
  STORAGE_SCHEMA_VERSION,
  type AccountConfig,
  type AccountRecord,
  type CredentialRecord,
  type InstanceBrandingRecord,
  type StoredData,
  isSyncRangePreference,
} from "../../domain";
import {
  buildIdentityKey,
  instanceBrandingKey,
} from "../../domain/account-identity";
import { updateBrandingCache } from "../../domain/instance-branding";
import {
  updateActivityScheduleCache,
  type ActivityScheduleRecord,
} from "../../domain/activity-schedule";

const STORAGE_KEY = "ojtrace:data";

export interface StorageAreaLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StoragePort {
  load(): Promise<StoredData>;
  /** Single-writer transaction. The callback must be synchronous and pure. */
  transact(operation: (current: StoredData) => StoredData): Promise<StoredData>;
  clear(): Promise<void>;
}

export function defaultStoredData(): StoredData {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    revision: 0,
    accounts: [],
    credentials: [],
    instanceBranding: {},
    activitySchedules: {},
    submissions: [],
    syncStates: {},
    preferences: { ...DEFAULT_PREFERENCES },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeCredentials(
  value: unknown,
): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    ([key, item]) =>
      key.length > 0 && typeof item === "string" && !/[\r\n]/.test(item),
  );
  return entries.length
    ? (Object.fromEntries(entries) as Record<string, string>)
    : undefined;
}

function sanitizeAccount(value: unknown): AccountRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.accountId !== "string" ||
    typeof value.source !== "string" ||
    !["codeforces", "luogu", "qoj", "atcoder", "hydroj"].includes(
      value.source,
    ) ||
    typeof value.enabled !== "boolean" ||
    typeof value.providerAccountKey !== "string" ||
    typeof value.identityKey !== "string" ||
    ![
      value.verifiedAt,
      value.createdAt,
      value.updatedAt,
      value.credentialRevision,
    ].every((item) => typeof item === "number" && Number.isFinite(item)) ||
    !["public-handle", "browser-session", "manual-cookie", "password"].includes(
      String(value.authMode),
    ) ||
    Object.prototype.hasOwnProperty.call(value, "cookie")
  ) {
    return undefined;
  }
  try {
    if (
      buildIdentityKey({
        source: value.source as AccountConfig["source"],
        origin: value.origin as string | undefined,
        domainId: value.domainId as string | undefined,
        providerAccountKey: value.providerAccountKey as string,
      }) !== value.identityKey
    )
      return undefined;
  } catch {
    return undefined;
  }
  return {
    accountId: value.accountId,
    source: value.source as AccountConfig["source"],
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    enabled: value.enabled,
    authMode: value.authMode as AccountConfig["authMode"],
    ...(typeof value.origin === "string" ? { origin: value.origin } : {}),
    ...(typeof value.domainId === "string" ? { domainId: value.domainId } : {}),
    providerAccountKey: value.providerAccountKey as string,
    ...(typeof value.providerDisplayName === "string"
      ? { providerDisplayName: value.providerDisplayName }
      : {}),
    identityKey: value.identityKey as string,
    verifiedAt: value.verifiedAt as number,
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
    credentialRevision: value.credentialRevision as number,
  };
}

function sanitizeCredentialRecord(
  value: unknown,
): CredentialRecord | undefined {
  if (!isRecord(value) || typeof value.accountId !== "string") return undefined;
  const credentials = sanitizeCredentials(value.credentials);
  if (!credentials) return undefined;
  return {
    accountId: value.accountId,
    credentials,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

function sanitizeBranding(value: unknown): InstanceBrandingRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.source !== "string" ||
    typeof value.origin !== "string" ||
    typeof value.name !== "string" ||
    typeof value.fetchedAt !== "number"
  )
    return undefined;
  try {
    instanceBrandingKey(
      value.source as InstanceBrandingRecord["source"],
      value.origin,
      value.domainId as string | undefined,
    );
  } catch {
    return undefined;
  }
  if (
    !Number.isFinite(value.fetchedAt) ||
    !value.name.trim() ||
    value.name.length > 80
  )
    return undefined;
  return {
    source: value.source as InstanceBrandingRecord["source"],
    origin: value.origin,
    ...(typeof value.domainId === "string" ? { domainId: value.domainId } : {}),
    name: value.name,
    ...(typeof value.iconDataUrl === "string" &&
    value.iconDataUrl.length <= 90_000 &&
    /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/.test(
      value.iconDataUrl,
    )
      ? { iconDataUrl: value.iconDataUrl }
      : {}),
    fetchedAt: value.fetchedAt,
    ...(typeof value.iconFetchedAt === "number"
      ? { iconFetchedAt: value.iconFetchedAt }
      : {}),
  };
}

function isStoredData(value: unknown): value is StoredData {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === STORAGE_SCHEMA_VERSION &&
    typeof value.revision === "number" &&
    Array.isArray(value.accounts) &&
    Array.isArray(value.credentials) &&
    Array.isArray(value.submissions) &&
    isRecord(value.syncStates) &&
    isRecord(value.preferences)
  );
}

function validateStoredData(value: StoredData): StoredData {
  const accounts = value.accounts
    .map(sanitizeAccount)
    .filter((account): account is AccountRecord => Boolean(account));
  const validAccountIds = new Set(accounts.map((account) => account.accountId));
  const accountsById = new Map(
    accounts.map((account) => [account.accountId, account]),
  );
  const credentials = value.credentials
    .map(sanitizeCredentialRecord)
    .filter((item): item is CredentialRecord =>
      Boolean(item && validAccountIds.has(item.accountId)),
    );
  const instanceBranding = updateBrandingCache(
    {},
    Object.values(
      isRecord(value.instanceBranding) ? value.instanceBranding : {},
    )
      .map(sanitizeBranding)
      .filter((item): item is InstanceBrandingRecord => Boolean(item)),
  );
  const submissions = value.submissions.filter(
    (item) =>
      isRecord(item) &&
      typeof item.source === "string" &&
      typeof item.accountId === "string" &&
      validAccountIds.has(item.accountId) &&
      item.source === accountsById.get(item.accountId)?.source &&
      typeof item.submissionId === "string" &&
      (item.origin === undefined || typeof item.origin === "string") &&
      (item.domainId === undefined || typeof item.domainId === "string") &&
      (item.source !== "hydroj" ||
        (item.origin === accountsById.get(item.accountId)?.origin &&
          item.domainId === accountsById.get(item.accountId)?.domainId)) &&
      Number.isFinite(item.submittedAt) &&
      Number.isFinite(item.fetchedAt),
  );
  const syncAccountIds = Array.isArray(value.preferences.syncAccountIds)
    ? [
        ...new Set(
          value.preferences.syncAccountIds.filter(
            (accountId): accountId is string =>
              typeof accountId === "string" && validAccountIds.has(accountId),
          ),
        ),
      ]
    : undefined;
  const { retentionPerAccount, freshnessCooldownMs } = value.preferences;
  const preferences: StoredData["preferences"] = {
    retentionPerAccount:
      Number.isSafeInteger(retentionPerAccount) && retentionPerAccount > 0
        ? retentionPerAccount
        : DEFAULT_PREFERENCES.retentionPerAccount,
    freshnessCooldownMs:
      Number.isFinite(freshnessCooldownMs) && freshnessCooldownMs >= 0
        ? freshnessCooldownMs
        : DEFAULT_PREFERENCES.freshnessCooldownMs,
    ...(syncAccountIds === undefined ? {} : { syncAccountIds }),
  };
  if (isSyncRangePreference(value.preferences.syncRange)) {
    const { from, to, followNow, preset } = value.preferences.syncRange;
    preferences.syncRange = {
      from,
      to,
      followNow,
      ...(preset === undefined ? {} : { preset }),
    };
  } else {
    delete preferences.syncRange;
  }
  return {
    ...value,
    accounts,
    credentials,
    instanceBranding,
    activitySchedules: updateActivityScheduleCache(
      {},
      isRecord(value.activitySchedules)
        ? (Object.values(value.activitySchedules) as ActivityScheduleRecord[])
        : [],
    ),
    submissions,
    preferences,
  };
}

function migrate(value: unknown): StoredData {
  if (isStoredData(value)) return validateStoredData(value);
  return defaultStoredData();
}

export function createStoragePort(area: StorageAreaLike): StoragePort {
  let writeQueue = Promise.resolve();

  async function load(): Promise<StoredData> {
    const result = await area.get(STORAGE_KEY);
    return migrate(result[STORAGE_KEY]);
  }

  async function write(next: StoredData): Promise<StoredData> {
    const persisted: StoredData = {
      ...next,
      schemaVersion: STORAGE_SCHEMA_VERSION,
      accounts: next.accounts
        .map(sanitizeAccount)
        .filter((item): item is AccountRecord => Boolean(item)),
    };
    try {
      await area.set({ [STORAGE_KEY]: persisted });
    } catch (error) {
      if (
        Object.keys(persisted.instanceBranding).length === 0 &&
        Object.keys(persisted.activitySchedules).length === 0
      )
        throw error;
      // Discardable caches must not prevent account/record persistence.
      persisted.instanceBranding = {};
      persisted.activitySchedules = {};
      await area.set({ [STORAGE_KEY]: persisted });
    }
    return persisted;
  }

  return {
    load,

    async transact(operation) {
      let output!: StoredData;
      const task = writeQueue.then(async () => {
        const current = await load();
        const candidate = operation(current);
        output = await write({ ...candidate, revision: current.revision + 1 });
      });
      writeQueue = task.catch(() => undefined);
      await task;
      return output;
    },

    async clear() {
      const task = writeQueue.then(() =>
        write(defaultStoredData()).then(() => undefined),
      );
      writeQueue = task.catch(() => undefined);
      await task;
    },
  };
}
