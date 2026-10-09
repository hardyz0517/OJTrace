import { describe, expect, it } from "vitest";
import {
  commandCredentialInput,
  formCredentialInput,
  requiresIdentifier,
} from "../../src/domain/auth-input";
import type { AuthModeDefinition } from "../../src/domain/adapter";
import { isCredentialEntry } from "../../src/domain/credentials";

const password: AuthModeDefinition = {
  type: "password",
  credentialFields: [
    { key: "username", label: "User" },
    { key: "password", label: "Password" },
    { key: "optional", label: "Optional", required: false },
  ],
};
describe("authorization input boundaries", () => {
  it("retains the different form and command normalization contracts", () => {
    const values = { username: " user ", password: " secret ", optional: " " };
    expect(formCredentialInput(password, values)).toEqual({
      credentials: { username: "user", password: " secret " },
    });
    expect(commandCredentialInput(password, values)).toEqual({
      credentials: values,
    });
  });
  it("preserves whitespace-only password rejection at the service boundary", () => {
    expect(
      formCredentialInput(password, { username: "user", password: " " }).issue,
    ).toBeUndefined();
    expect(
      commandCredentialInput(password, { username: "user", password: " " })
        .issue,
    ).toBe("required-field");
  });
  it("rejects unknown command fields before missing required fields and mode discard", () => {
    expect(commandCredentialInput(password, { other: "value" }).issue).toBe(
      "unknown-field",
    );
    expect(
      commandCredentialInput({ type: "browser-session" }, { other: "value" })
        .issue,
    ).toBe("unknown-field");
    expect(
      formCredentialInput(password, {
        username: "u",
        password: "p",
        other: "value",
      }).credentials,
    ).toEqual({ username: "u", password: "p" });
  });
  it("keeps identifier requirements and basic entry validation independent", () => {
    expect(requiresIdentifier({ type: "browser-session" })).toBe(false);
    expect(
      requiresIdentifier({ type: "password", identifierRequired: false }),
    ).toBe(false);
    expect(requiresIdentifier({ type: "public-handle" })).toBe(true);
    expect(isCredentialEntry("password", " ")).toBe(true);
    for (const value of [undefined, 3, "a\r\nb"])
      expect(isCredentialEntry("cookie", value)).toBe(false);
    expect(isCredentialEntry("", "value")).toBe(false);
  });
});
