import { describe, expect, it, vi } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import {
  BRANDING_REFRESH_MS,
  refreshInstanceBranding,
} from "../../src/application/sync/instance-branding";
import { updateBrandingCache } from "../../src/domain/instance-branding";
import { instanceBrandingKey } from "../../src/domain/account-identity";
import type {
  InstanceBrandingRecord,
  InstanceMetadataInput,
} from "../../src/domain";

const branding: InstanceBrandingRecord = {
  source: "hydroj",
  origin: "https://brand.example.org",
  name: "School OJ",
  fetchedAt: 10,
  iconDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  iconFetchedAt: 10,
};
function input(now: number): InstanceMetadataInput {
  return {
    account: {
      accountId: "a",
      source: "hydroj",
      origin: branding.origin,
      enabled: true,
      authMode: "browser-session",
    },
    now,
    requestId: "r",
    signal: new AbortController().signal,
    http: {
      request: async () => {
        throw new Error("unexpected");
      },
    },
  };
}
describe("instance branding lifecycle", () => {
  it("skips fresh cache and coalesces stale requests for an instance", async () => {
    let resolve!: (value: {
      branding: InstanceBrandingRecord;
      diagnostics: [];
    }) => void;
    const pending = new Promise<{
      branding: InstanceBrandingRecord;
      diagnostics: [];
    }>((done) => {
      resolve = done;
    });
    const fetchInstanceBranding = vi.fn(() => pending);
    const adapter = { ...hydroOJAdapter, fetchInstanceBranding };
    await refreshInstanceBranding(adapter, input(20), branding);
    expect(fetchInstanceBranding).not.toHaveBeenCalled();
    const first = refreshInstanceBranding(
      adapter,
      input(20 + BRANDING_REFRESH_MS),
      branding,
    );
    const second = refreshInstanceBranding(
      adapter,
      input(20 + BRANDING_REFRESH_MS),
      branding,
    );
    resolve({
      branding: { ...branding, fetchedAt: 20 + BRANDING_REFRESH_MS },
      diagnostics: [],
    });
    expect(await first).toEqual(await second);
    expect(fetchInstanceBranding).toHaveBeenCalledTimes(1);
  });
  it("retains old icon on name-only refresh and preserves origin isolation", () => {
    const key = instanceBrandingKey(branding.source, branding.origin);
    const next = updateBrandingCache({ [key]: branding }, [
      {
        ...branding,
        name: "New name",
        fetchedAt: 20,
        iconDataUrl: undefined,
        iconFetchedAt: undefined,
      },
      {
        source: "hydroj",
        origin: "https://other.example.org",
        name: "Other",
        fetchedAt: 20,
      },
    ]);
    expect(next[key]).toMatchObject({
      name: "New name",
      iconDataUrl: branding.iconDataUrl,
      iconFetchedAt: 10,
    });
    expect(Object.values(next)).toHaveLength(2);
  });
  it("bounds the cache to 32 most recently refreshed instances", () => {
    const next = updateBrandingCache(
      {},
      Array.from({ length: 40 }, (_, index) => ({
        ...branding,
        origin: `https://b${index}.example.org`,
        fetchedAt: index,
      })),
    );
    expect(Object.values(next)).toHaveLength(32);
    expect(Object.values(next).every((item) => item.fetchedAt >= 8)).toBe(true);
  });
  it("turns a failed refresh into a diagnostic without destroying cache", async () => {
    const adapter = {
      ...hydroOJAdapter,
      fetchInstanceBranding: async () => {
        throw new Error("private response");
      },
    };
    const refreshed = await refreshInstanceBranding(
      adapter,
      input(20 + BRANDING_REFRESH_MS),
      branding,
    );
    expect(refreshed.diagnostics[0]?.messageKey).toBe(
      "source.brandingUnavailable",
    );
    expect(JSON.stringify(refreshed)).not.toContain("private response");
    const key = instanceBrandingKey(branding.source, branding.origin);
    expect(updateBrandingCache({ [key]: branding }, [])[key]).toEqual(branding);
  });
});
