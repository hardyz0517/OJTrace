import {
  DEFAULT_PREFERENCES,
  STORAGE_SCHEMA_VERSION,
  type AccountConfig,
  type StoredData,
} from "../../domain";

const STORAGE_KEY = "ojtrace:data";

export interface StorageAreaLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StoragePort {
  load(): Promise<StoredData>;
  update(mutator: (current: StoredData) => StoredData): Promise<StoredData>;
}

export function defaultStoredData(): StoredData {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    revision: 0,
    accounts: [],
    submissions: [],
    syncStates: {},
    preferences: {
      ...DEFAULT_PREFERENCES,
      enabledSources: [...DEFAULT_PREFERENCES.enabledSources],
    },
  };
}

function isStoredData(value: unknown): value is StoredData {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredData>;
  return (
    record.schemaVersion === STORAGE_SCHEMA_VERSION &&
    typeof record.revision === "number" &&
    Array.isArray(record.accounts) &&
    Array.isArray(record.submissions) &&
    !!record.syncStates &&
    !!record.preferences
  );
}

function migrate(value: unknown): StoredData {
  if (isStoredData(value)) return value;
  return defaultStoredData();
}

export function createStoragePort(area: StorageAreaLike): StoragePort {
  let writeQueue = Promise.resolve();

  return {
    async load() {
      const result = await area.get(STORAGE_KEY);
      return migrate(result[STORAGE_KEY]);
    },

    async update(mutator) {
      let output!: StoredData;
      const operation = writeQueue.then(async () => {
        const current = await this.load();
        output = mutator(current);
        const next: StoredData = {
          ...output,
          schemaVersion: STORAGE_SCHEMA_VERSION,
          revision: current.revision + 1,
        };
        await area.set({ [STORAGE_KEY]: next });
        output = next;
      });
      writeQueue = operation.catch(() => undefined);
      await operation;
      return output;
    },
  };
}

export function upsertAccount(
  data: StoredData,
  account: AccountConfig,
): StoredData {
  const accounts = data.accounts.filter(
    (item) => item.accountId !== account.accountId,
  );
  accounts.push(account);
  return { ...data, accounts };
}
