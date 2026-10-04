import { describe, it, expect } from "vitest";
import {
  buildIdentityKey,
  normalizeOrigin,
} from "../../src/domain/account-identity";

describe("canonical account identity", () => {
  it("isolates one UID in the root and each explicit Hydro domain", () => {
    const identity = {
      source: "hydroj" as const,
      origin: "http://oj.example.org",
      providerAccountKey: "42",
    };
    const keys = [undefined, "student", "teacher"].map((domainId) =>
      buildIdentityKey({ ...identity, domainId }),
    );
    expect(new Set(keys).size).toBe(3);
    expect(() => buildIdentityKey({ ...identity, domainId: "a/b" })).toThrow();
    expect(() =>
      buildIdentityKey({
        source: "qoj",
        providerAccountKey: "42",
        domainId: "student",
      }),
    ).toThrow();
  });
  it("normalizes origins and isolates Hydro instances", () => {
    expect(normalizeOrigin("https://OJ.EXAMPLE.org/")).toBe(
      "https://oj.example.org",
    );
    const identity = { source: "hydroj" as const, providerAccountKey: "42" };
    expect(
      buildIdentityKey({ ...identity, origin: "https://OJ.EXAMPLE.org/" }),
    ).toBe(buildIdentityKey({ ...identity, origin: "https://oj.example.org" }));
    expect(
      buildIdentityKey({ ...identity, origin: "https://other.example.org" }),
    ).not.toBe(
      buildIdentityKey({ ...identity, origin: "https://oj.example.org" }),
    );
  });
  it("rejects incomplete or ambiguous identities", () => {
    for (const origin of [
      "https://oj.example.org/path",
      "https://oj.example.org/?a=1",
      "https://u:p@oj.example.org",
      "https://oj.example.org/#a",
    ])
      expect(() => normalizeOrigin(origin)).toThrow();
    expect(() =>
      buildIdentityKey({ source: "hydroj", providerAccountKey: "42" }),
    ).toThrow();
    expect(() =>
      buildIdentityKey({
        source: "qoj",
        origin: "https://qoj.ac",
        providerAccountKey: "u",
      }),
    ).toThrow();
    expect(() =>
      buildIdentityKey({ source: "qoj", providerAccountKey: "\n" }),
    ).toThrow();
  });
});
