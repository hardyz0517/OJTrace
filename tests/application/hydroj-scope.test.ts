import { describe, expect, it } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import { instanceBrandingFor } from "../../src/application/accounts/account-queries";
import { guardCollection } from "../../src/application/sync/collect-account";
import { refreshInstanceBranding } from "../../src/application/sync/instance-branding";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import { instanceBrandingKey } from "../../src/domain/account-identity";
import { updateBrandingCache } from "../../src/domain/instance-branding";
import type {
  InstanceBrandingRecord,
  InstanceMetadataInput,
  Submission,
} from "../../src/domain";
import { accountRecord } from "../account-fixture";

const origin = "https://scope.example.org";
const student = accountRecord({
  accountId: "student",
  source: "hydroj",
  origin,
  domainId: "student",
  providerAccountKey: "42",
  authMode: "password",
  enabled: true,
});
const submission: Submission = {
  accountId: student.accountId,
  source: "hydroj",
  origin,
  domainId: "student",
  providerAccountKey: "42",
  submissionId: "record",
  problemId: "1",
  identityQuality: "stable",
  submittedAt: 50,
  fetchedAt: 100,
  verdict: { code: "accepted", raw: "1" },
};
function branding(domainId?: string): InstanceBrandingRecord {
  return {
    source: "hydroj",
    origin,
    domainId,
    name: "HydroOJ",
    fetchedAt: 100,
    iconDataUrl: `data:image/png;base64,${domainId === "student" ? "AAAA" : "BBBB"}`,
  };
}

describe("Hydro application scope boundaries", () => {
  it.each([undefined, "teacher"])(
    "rejects an adapter record from domain %s before commit",
    (domainId) => {
      expect(() =>
        guardCollection({
          account: student,
          window: { since: 0, until: 100 },
          attemptAt: 100,
          result: {
            accountId: student.accountId,
            source: "hydroj",
            records: [{ ...submission, domainId }],
            diagnostics: [],
            stale: false,
          },
        }),
      ).toThrow();
    },
  );

  it("drops mixed-domain persisted records without losing valid accounts or records", async () => {
    const state = {
      ...defaultStoredData(),
      accounts: [student],
      submissions: [
        submission,
        { ...submission, submissionId: "root", domainId: undefined },
        { ...submission, submissionId: "other", domainId: "teacher" },
        { ...submission, submissionId: "forged", source: "luogu" },
      ],
    };
    const storage = createStoragePort({
      get: async () => ({ "ojtrace:data": state }),
      set: async () => {},
    });
    const loaded = await storage.load();
    expect(loaded.accounts).toEqual([student]);
    expect(loaded.submissions).toEqual([submission]);
  });

  it("isolates icon merges and lookups by domain and never falls back to another domain", () => {
    const initial = updateBrandingCache({}, [
      branding(),
      branding("student"),
      branding("teacher"),
    ]);
    const cache = updateBrandingCache(initial, [
      { ...branding("student"), iconDataUrl: undefined, fetchedAt: 200 },
    ]);
    expect(Object.keys(cache)).toHaveLength(3);
    expect(
      cache[instanceBrandingKey("hydroj", origin, "student")]?.iconDataUrl,
    ).toBe("data:image/png;base64,AAAA");
    expect(
      cache[instanceBrandingKey("hydroj", origin, "teacher")]?.fetchedAt,
    ).toBe(100);
    expect(
      instanceBrandingFor({ instanceBranding: cache }, student)?.fetchedAt,
    ).toBe(200);
    expect(
      instanceBrandingFor(
        { instanceBranding: cache },
        { ...student, domainId: "missing" },
      ),
    ).toBeUndefined();
  });

  it("deduplicates same-domain refreshes but not another domain on the same origin", async () => {
    const calls: Array<string | undefined> = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = {
      ...hydroOJAdapter,
      async fetchInstanceBranding(input: InstanceMetadataInput) {
        calls.push(input.account.domainId);
        await gate;
        return { branding: branding(input.account.domainId), diagnostics: [] };
      },
    };
    const context: InstanceMetadataInput = {
      account: student,
      now: 100,
      requestId: "branding",
      signal: new AbortController().signal,
      http: {
        request: async () => {
          throw new Error("unexpected HTTP");
        },
      },
    };
    const first = refreshInstanceBranding(adapter, context);
    const shared = refreshInstanceBranding(adapter, {
      ...context,
      account: { ...student, accountId: "same-domain" },
    });
    const separate = refreshInstanceBranding(adapter, {
      ...context,
      account: { ...student, domainId: "teacher" },
    });
    expect(calls).toEqual(["student", "teacher"]);
    release();
    const results = await Promise.all([first, shared, separate]);
    expect(results.map((result) => result.branding?.domainId)).toEqual([
      "student",
      "student",
      "teacher",
    ]);
    expect(results[0]).toBe(results[1]);
  });
});
