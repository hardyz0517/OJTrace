import { describe, expect, it, vi, afterEach } from "vitest";
import { createAccountService } from "../../src/application/accounts/account-service";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import { syncEnabledAccounts } from "../../src/application/sync/sync-service";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import type {
  CanonicalAccount,
  FetchInput,
  AuthorizeInput,
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
  const sync = () =>
    syncEnabledAccounts(storage, http, {
      force: true,
      now: 10,
      since: 0,
      until: 10,
    });
  return { storage, service, sync };
}
const command = {
  source: "hydroj" as const,
  authMode: "password" as const,
  origin: "https://oj.example.org",
  credentials: { username: "test-user", password: "test-password" },
  requestId: "request",
};
const canonical = (input: AuthorizeInput): CanonicalAccount => ({
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
      ...(input.account.domainId ? { domainId: input.account.domainId } : {}),
      submissionId: "1",
      identityQuality: "stable",
      problemId: "P1",
      submittedAt: 1,
      fetchedAt: 10,
      verdict: { code: "accepted", raw: "Accepted" },
    },
  ],
  diagnostics: [],
  coverage: {
    window: { since: input.since, until: input.until },
    pagesFetched: 1,
    acceptedRecords: 1,
    outcome: { status: "complete", evidence: "exhausted" },
  },
});

afterEach(() => vi.restoreAllMocks());

describe("account lifecycle", () => {
  it("saves an authorized account without collecting records until explicitly synced", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
      canonical(input),
    );
    const fetcher = vi
      .spyOn(hydroOJAdapter, "fetchRecent")
      .mockImplementation(async (input) => records(input));
    const branding = vi
      .spyOn(hydroOJAdapter, "fetchInstanceBranding")
      .mockResolvedValue({ diagnostics: [] });
    const { service, storage, sync } = fixture();
    const authorized = await service.authorize(command);
    expect(authorized.superseded).toBe(false);
    expect(authorized.data.accounts).toEqual([authorized.account]);
    expect(authorized.data.credentials).toHaveLength(1);
    expect(authorized.data.submissions).toEqual([]);
    expect(authorized.data.syncStates[authorized.account.accountId]).toEqual({
      stale: true,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(branding).not.toHaveBeenCalled();

    await sync();
    expect(fetcher).toHaveBeenCalledOnce();
    const synced = await storage.load();
    expect(synced.submissions).toHaveLength(1);
    expect(synced.syncStates[authorized.account.accountId]?.lastSuccessAt).toBe(
      10,
    );
  });

  it("binds the same Hydro UID to distinct domains and reauthorizes one without replacing the others", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
      canonical(input),
    );
    vi.spyOn(hydroOJAdapter, "fetchRecent").mockImplementation(async (input) =>
      records(input),
    );
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
    });
    const { service, storage, sync } = fixture();
    const root = await service.authorize(command);
    const student = await service.authorize({
      ...command,
      origin: `${command.origin}/d/student/`,
    });
    const teacher = await service.authorize({
      ...command,
      origin: command.origin,
      domainId: "teacher",
    });
    await sync();
    const renewed = await service.authorize({
      ...command,
      origin: `${command.origin}/d/student`,
    });
    expect(student.account.origin).toBe(command.origin);
    expect(student.account.domainId).toBe("student");
    expect(renewed.account.accountId).toBe(student.account.accountId);
    const data = await storage.load();
    expect(data.accounts).toHaveLength(3);
    expect(data.credentials).toHaveLength(3);
    expect(data.submissions).toHaveLength(3);
    expect(
      new Set(data.accounts.map((account) => account.identityKey)).size,
    ).toBe(3);
    await service.remove(student.account.accountId);
    const removed = await storage.load();
    expect(removed.accounts.map((account) => account.accountId).sort()).toEqual(
      [root.account.accountId, teacher.account.accountId].sort(),
    );
    expect(removed.submissions).toHaveLength(2);
  });
  it("does not let a slower earlier authorization overwrite newer credentials", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) => {
      if (input.credentials?.password === "old-password") {
        started();
        await gate;
      }
      return canonical(input);
    });
    vi.spyOn(hydroOJAdapter, "fetchRecent").mockImplementation(async (input) =>
      records(input),
    );
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
    });
    const { service, storage } = fixture();
    const older = service.authorize({
      ...command,
      credentials: { username: "test-user", password: "old-password" },
    });
    const rejected = expect(older).rejects.toMatchObject({
      code: "superseded",
    });
    await ready;
    await service.authorize({
      ...command,
      credentials: { username: "test-user", password: "new-password" },
    });
    release();
    await rejected;
    expect((await storage.load()).credentials[0]?.credentials.password).toBe(
      "new-password",
    );
    expect((await storage.load()).accounts).toHaveLength(1);
  });

  it("does not persist a pending identity authorization after accounts are cleared", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) => {
      started();
      await gate;
      return canonical(input);
    });
    const fetcher = vi.spyOn(hydroOJAdapter, "fetchRecent");
    const { service, storage } = fixture();
    const pending = service.authorize(command);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "superseded",
    });
    await ready;
    await service.clearAll();
    release();
    await rejected;
    expect((await storage.load()).accounts).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports authorization as superseded when cancelled after persistence", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
      canonical(input),
    );
    const fetcher = vi.spyOn(hydroOJAdapter, "fetchRecent");
    const { service, storage } = fixture();
    const original = storage.transact.bind(storage);
    vi.spyOn(storage, "transact").mockImplementation((operation) => {
      return original(operation).then((data) => {
        service.cancelPending();
        return data;
      });
    });
    const result = await service.authorize(command);
    expect(result.superseded).toBe(true);
    expect(result.data.submissions).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
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
    const fetcher = vi
      .spyOn(hydroOJAdapter, "fetchRecent")
      .mockImplementation(async (input) => records(input));
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
    });
    const { service, storage, sync } = fixture();
    const first = await service.authorize({
      ...command,
      label: "  School OJ  ",
    });
    expect(first.account.label).toBe("School OJ");
    expect((await storage.load()).accounts[0]?.label).toBe("School OJ");
    await sync();
    fetcher.mockClear();
    const second = await service.authorize({
      ...command,
      label: "Renamed OJ",
      credentials: { username: "new-name", password: "new-password" },
    });
    expect(second.account.label).toBe("Renamed OJ");
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
    const loaded = await storage.load();
    expect(fetcher).not.toHaveBeenCalled();
    expect(loaded.credentials).toEqual([]);
    expect(loaded.accounts[0]?.label).toBe("HydroOJ");
  });

  it.each([undefined, "", "   "])(
    "defaults an omitted or blank instance name (%s) to HydroOJ",
    async (label) => {
      vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
        canonical(input),
      );
      const { service, storage } = fixture();
      const result = await service.authorize({ ...command, label });
      expect(result.account.label).toBe("HydroOJ");
      expect((await storage.load()).accounts[0]?.label).toBe("HydroOJ");
    },
  );

  it("isolates the same UID across origins without collecting records", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
      canonical(input),
    );
    const fetcher = vi.spyOn(hydroOJAdapter, "fetchRecent");
    const { service } = fixture();
    await service.authorize(command);
    const second = await service.authorize({
      ...command,
      origin: "https://other.example.org",
    });
    expect(second.data.accounts).toHaveLength(2);
    expect(second.data.accounts.every((account) => account.enabled)).toBe(true);
    expect(second.data.submissions).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not persist an account when identity validation fails", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockRejectedValue(
      new Error("rejected"),
    );
    const { service, storage } = fixture();
    await expect(service.authorize(command)).rejects.toThrow();
    expect(await storage.load()).toEqual(defaultStoredData());
  });

  it("authorizes identity independently when a saved fixed window has expired", async () => {
    const authorize = vi
      .spyOn(hydroOJAdapter, "authorize")
      .mockImplementation(async (input) => canonical(input));
    const fetcher = vi.spyOn(hydroOJAdapter, "fetchRecent");
    const { storage } = fixture();
    await storage.transact((data) => ({
      ...data,
      preferences: {
        ...data.preferences,
        syncRange: { from: 0, to: 1, followNow: false },
      },
    }));
    const service = createAccountService(storage, {
      http: {
        request: async () => {
          throw new Error("unexpected HTTP");
        },
      },
      ensurePermission: async () => true,
      now: () => 40 * 86_400_000,
    });
    const result = await service.authorize(command);
    expect(result.account.enabled).toBe(true);
    expect(result).not.toHaveProperty("coverage");
    expect(result).not.toHaveProperty("diagnostics");
    expect(authorize.mock.calls[0]?.[0]).not.toHaveProperty("since");
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      result.data.syncStates[result.account.accountId]?.lastSuccessAt,
    ).toBeUndefined();
  });

  it("keeps an existing enabled choice and never counts authorization as a successful collection", async () => {
    vi.spyOn(hydroOJAdapter, "authorize").mockImplementation(async (input) =>
      canonical(input),
    );
    const fetcher = vi
      .spyOn(hydroOJAdapter, "fetchRecent")
      .mockImplementation(async (input) => records(input));
    vi.spyOn(hydroOJAdapter, "fetchInstanceBranding").mockResolvedValue({
      diagnostics: [],
    });
    const { service, storage, sync } = fixture();
    const first = await service.authorize(command);
    await sync();
    await storage.transact((data) => ({
      ...data,
      accounts: data.accounts.map((account) => ({
        ...account,
        enabled: false,
      })),
    }));
    fetcher.mockClear();
    const second = await service.authorize(command);
    expect(second.account.accountId).toBe(first.account.accountId);
    expect(second.account.enabled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      second.data.syncStates[second.account.accountId]?.lastSuccessAt,
    ).toBe(10);
    expect(second.data.syncStates[second.account.accountId]?.stale).toBe(true);
  });

  it("does not resurrect an account removed before the authorization response", async () => {
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
    const fetcher = vi.spyOn(hydroOJAdapter, "fetchRecent");
    const { service, storage } = fixture();
    const upsert = service.upsertAuthorized.bind(service);
    vi.spyOn(service, "upsertAuthorized").mockImplementation(async (input) => {
      const saved = await upsert(input);
      started();
      await gate;
      return saved;
    });
    const adding = service.authorize(command);
    await ready;
    const id = (await storage.load()).accounts[0]!.accountId;
    await service.remove(id);
    release();
    const result = await adding;
    expect(result.superseded).toBe(true);
    expect(result.data.accounts).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
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
    const { service, storage, sync } = fixture();
    await service.authorize(command);
    await sync();
    const before = await storage.load();
    expect(before.credentials).toHaveLength(1);
    expect(before.submissions).toHaveLength(1);
    expect(Object.keys(before.instanceBranding)).toHaveLength(1);
    const data = await service.clearAll();
    expect(data.accounts).toEqual([]);
    expect(data.credentials).toEqual([]);
    expect(data.submissions).toEqual([]);
    expect(data.instanceBranding).toEqual({});
    expect(data.preferences.syncAccountIds).toEqual([]);
  });
});
