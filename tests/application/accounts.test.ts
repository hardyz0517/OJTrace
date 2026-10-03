import { describe, expect, it, vi, afterEach } from "vitest";
import { createAccountService } from "../../src/application/accounts/account-service";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import type {
  CanonicalAccount,
  FetchInput,
  FetchResult,
  HttpClient,
} from "../../src/domain";

function fixture() {
  let value: Record<string, unknown> = {};
  const storage = createStoragePort({
    get: async () => value,
    set: async (next) => {
      value = { ...value, ...next };
    },
  });
  const http: HttpClient = {
    async request() {
      throw new Error("unexpected request");
    },
  };
  const service = createAccountService(storage, {
    http,
    ensurePermission: async () => true,
    now: () => 10,
  });
  return { storage, service };
}
const command = {
  source: "hydroj" as const,
  authMode: "password" as const,
  origin: "https://oj.example.org",
  credentials: { username: "test-user", password: "test-password" },
  requestId: "request",
};
const canonical = (input: FetchInput): CanonicalAccount => ({
  accountId: input.account.accountId,
  source: "hydroj",
  providerAccountKey: "42",
  displayName: "test-user",
});
const records = (input: FetchInput): FetchResult => ({
  account: canonical(input),
  records: [
    {
      source: "hydroj",
      accountId: input.account.accountId,
      providerAccountKey: "42",
      origin: input.account.origin,
      submissionId: "1",
      identityQuality: "stable",
      problemId: "P1",
      submittedAt: 1,
      fetchedAt: 10,
      verdict: { code: "accepted", raw: "Accepted" },
    },
  ],
  diagnostics: [],
  hasMore: false,
});

afterEach(() => vi.restoreAllMocks());

describe("account lifecycle", () => {
  it("rejects undeclared credential fields before authorization or persistence", async () => {
    const authorize = vi.spyOn(hydroOJAdapter, "authorize");
    const { service, storage } = fixture();
    await expect(
      service.authorize({
        ...command,
        credentials: { ...command.credentials, unknown: "private" },
      }),
    ).rejects.toMatchObject({
      code: "invalid-input",
      messageKey: "account.credentialsInvalid",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect((await storage.load()).accounts).toEqual([]);
  });
  it("upserts a canonical identity, preserves records, replaces credentials, and never exposes them", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
      canonical(input),
    );
    vi.spyOn(hydroOJAdapter, "fetchRecent").mockImplementation(async (input) =>
      records(input),
    );
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
    });
    const { service, storage } = fixture();
    const first = await service.authorize(command);
    const second = await service.authorize({
      ...command,
      credentials: { username: "new-name", password: "new-password" },
    });
    expect(second.account.accountId).toBe(first.account.accountId);
    expect(second.account.credentialRevision).toBe(2);
    expect(second.data.accounts).toHaveLength(1);
    expect(second.data.submissions).toHaveLength(1);
    expect(second.data.credentials[0]?.credentials.password).toBe(
      "new-password",
    );
    expect(second.account).not.toHaveProperty("identifier");
    expect(second.account).not.toHaveProperty("credentials");
    expect(JSON.stringify(publicStoredData(second.data))).not.toContain(
      "new-password",
    );
    expect(publicStoredData(second.data)).not.toHaveProperty("credentials");
    await service.authorize({
      ...command,
      authMode: "browser-session",
      credentials: undefined,
    });
    expect((await storage.load()).credentials).toEqual([]);
  });

  it("isolates same UID across origins and keeps failed initial sync accounts for reauthorization", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
      canonical(input),
    );
    vi.spyOn(hydroOJAdapter, "fetchRecent").mockRejectedValue(
      new Error("private response must not leak"),
    );
    const { service } = fixture();
    await service.authorize(command);
    const second = await service.authorize({
      ...command,
      origin: "https://other.example.org",
    });
    expect(second.data.accounts).toHaveLength(2);
    expect(second.data.accounts.every((account) => !account.enabled)).toBe(
      true,
    );
    expect(second.syncError?.messageKey).toBe("source.unknownError");
  });

  it("does not persist an account when identity validation fails", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockRejectedValue(
      new Error("rejected"),
    );
    const { service, storage } = fixture();
    await expect(service.authorize(command)).rejects.toThrow();
    expect(await storage.load()).toEqual(defaultStoredData());
  });

  it("does not resurrect an account removed during its first sync", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
      canonical(input),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(hydroOJAdapter, "fetchRecent").mockImplementation(
      async (input) => {
        started();
        await gate;
        return records(input);
      },
    );
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
    });
    const { service, storage } = fixture();
    const adding = service.authorize(command);
    await ready;
    const id = (await storage.load()).accounts[0]!.accountId;
    await service.remove(id);
    release();
    await adding;
    const data = await storage.load();
    expect(data.accounts).toEqual([]);
    expect(data.credentials).toEqual([]);
    expect(data.submissions).toEqual([]);
    expect(data.syncStates).toEqual({});
  });

  it("clears credentials, records, sync selection and branding in one transaction", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
      canonical(input),
    );
    vi.spyOn(hydroOJAdapter, "fetchRecent").mockImplementation(async (input) =>
      records(input),
    );
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
      branding: {
        source: "hydroj",
        origin: command.origin,
        name: "School",
        fetchedAt: 10,
      },
    });
    const { service } = fixture();
    await service.authorize(command);
    const data = await service.clearAll();
    expect(data.accounts).toEqual([]);
    expect(data.credentials).toEqual([]);
    expect(data.submissions).toEqual([]);
    expect(data.instanceBranding).toEqual({});
    expect(data.preferences.syncAccountIds).toEqual([]);
  });
});
