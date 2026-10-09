import type { AuthModeDefinition } from "./adapter";
import type { AccountCredentials } from "./types";

export function requiresIdentifier(mode: AuthModeDefinition): boolean {
  return mode.type !== "browser-session" && mode.identifierRequired !== false;
}

type CredentialsResult =
  | { credentials: AccountCredentials | undefined; issue?: never }
  | { issue: "unknown-field" | "required-field"; credentials?: never };

function readFields(
  mode: AuthModeDefinition,
  values: AccountCredentials | undefined,
  normalize: (key: string, value: string | undefined) => string | undefined,
  present: (value: string | undefined) => boolean,
): CredentialsResult {
  const entries: Array<[string, string]> = [];
  for (const field of mode.credentialFields ?? []) {
    const value = normalize(field.key, values?.[field.key]);
    if (field.required !== false && !present(value))
      return { issue: "required-field" };
    if (value) entries.push([field.key, value]);
  }
  return { credentials: Object.fromEntries(entries) };
}

/** Form boundary: trim non-password fields; preserve password bytes and ignore stray form keys. */
export function formCredentialInput(
  mode: AuthModeDefinition,
  values: AccountCredentials,
): CredentialsResult {
  return readFields(
    mode,
    values,
    (key, value) =>
      key === "password" ? (value ?? "") : (value?.trim() ?? ""),
    (value) => Boolean(value),
  );
}

/** Command boundary: reject unknown keys first, require trimmed content, retain original bytes. */
export function commandCredentialInput(
  mode: AuthModeDefinition,
  values: AccountCredentials | undefined,
): CredentialsResult {
  if (
    Object.keys(values ?? {}).some(
      (key) =>
        !(mode.credentialFields ?? []).some((field) => field.key === key),
    )
  ) {
    return { issue: "unknown-field" };
  }
  if (mode.type === "browser-session" || mode.type === "public-handle")
    return { credentials: undefined };
  return readFields(
    mode,
    values,
    (_key, value) => value,
    (value) => Boolean(value?.trim()),
  );
}
