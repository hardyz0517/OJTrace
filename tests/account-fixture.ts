import type { AccountConfig, AccountRecord } from "../src/domain";
import { buildIdentityKey } from "../src/domain/account-identity";

export function accountRecord(input: AccountConfig): AccountRecord {
  const { identifier, ...account } = input;
  const providerAccountKey = account.providerAccountKey ?? identifier ?? "user";
  return {
    ...account,
    providerAccountKey,
    identityKey: buildIdentityKey({ ...account, providerAccountKey }),
    verifiedAt: account.verifiedAt ?? 1,
    createdAt: account.createdAt ?? 1,
    updatedAt: account.updatedAt ?? 1,
    credentialRevision: account.credentialRevision ?? 1,
  };
}
