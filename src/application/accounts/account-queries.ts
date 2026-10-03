import type {
  AccountRecord,
  StoredData,
  InstanceBrandingRecord,
  SourceId,
} from "../../domain";
import { instanceBrandingKey } from "../../domain/account-identity";

export interface PublicStoredData extends Omit<StoredData, "credentials"> {
  accounts: Array<AccountRecord & { credentialConfigured: boolean }>;
}

export function publicStoredData(data: StoredData): PublicStoredData {
  const { credentials, ...state } = data;
  return {
    ...state,
    accounts: state.accounts.map((account) => ({
      ...account,
      credentialConfigured: credentials.some(
        (item) => item.accountId === account.accountId,
      ),
    })),
  };
}

export function instanceBrandingFor(
  data: Pick<StoredData, "instanceBranding">,
  account: { source: SourceId; origin?: string },
): InstanceBrandingRecord | undefined {
  if (account.source !== "hydroj" || !account.origin) return undefined;
  try {
    return data.instanceBranding[
      instanceBrandingKey(account.source, account.origin)
    ];
  } catch {
    return undefined;
  }
}
