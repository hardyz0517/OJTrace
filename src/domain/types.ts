export const STORAGE_SCHEMA_VERSION = 1 as const;
export const MESSAGE_SCHEMA_VERSION = 1 as const;

export type SourceId = "codeforces" | "luogu" | "qoj" | "atcoder" | "hydroj";
export type Availability = "stable" | "experimental" | "unsupported";
export type AccountAuthMode =
  "public-handle" | "browser-session" | "manual-cookie" | "password";

/**
 * Legacy values are accepted while loading existing local data. New account
 * records are always written with AccountAuthMode values.
 */
export type AuthMode = AccountAuthMode | "public" | "browser_session";
export type AccountCredentials = Record<string, string>;

export function normalizeAuthMode(mode: AuthMode): AccountAuthMode {
  if (mode === "public") return "public-handle";
  if (mode === "browser_session") return "browser-session";
  return mode;
}
export type IdentityQuality = "stable" | "composite";

export type VerdictCode =
  | "accepted"
  | "wrong_answer"
  | "compilation_error"
  | "runtime_error"
  | "time_limit"
  | "memory_limit"
  | "pending"
  | "partial"
  | "rejected"
  | "skipped"
  | "other";

export interface AccountConfig {
  accountId: string;
  source: SourceId;
  identifier: string;
  label?: string;
  enabled: boolean;
  authMode: AuthMode;
  /** Structured user-provided credentials for the explicit manual fallback. */
  credentials?: AccountCredentials;
  /** Legacy full Cookie value kept for migration compatibility. */
  cookie?: string;
  /** Exact HydroOJ instance origin, required for HydroOJ accounts. */
  origin?: string;
  providerAccountKey?: string;
  providerDisplayName?: string;
  verifiedAt?: number;
}

export interface Submission {
  source: SourceId;
  accountId: string;
  providerAccountKey?: string;
  origin?: string;
  submissionId: string;
  identityQuality: IdentityQuality;
  problemId: string;
  problemName?: string;
  submittedAt: number;
  verdict: {
    code: VerdictCode;
    raw: string;
  };
  score?: number;
  /** Execution time in milliseconds. */
  timeMs?: number;
  /** Peak memory in kilobytes. */
  memoryKb?: number;
  /** Submitted source size in bytes. */
  codeLength?: number;
  language?: string;
  submissionUrl?: string;
  problemUrl?: string;
  fallbackListUrl?: string;
  fetchedAt: number;
}

export interface Diagnostic {
  source: SourceId;
  code: string;
  severity: "info" | "warning" | "error";
  messageKey: string;
  retryable: boolean;
}

export type AdapterErrorKind =
  | "permission_required"
  | "auth_required"
  | "rate_limited"
  | "blocked"
  | "timeout"
  | "network"
  | "invalid_response"
  | "parse_failed"
  | "unsupported"
  | "unknown";

export interface AdapterError {
  kind: AdapterErrorKind;
  source: SourceId;
  stage: "identity" | "request" | "parse" | "normalize" | "url";
  messageKey: string;
  retryable: boolean;
  userAction?:
    "grant_permission" | "open_site_login" | "retry_later" | "edit_account";
  httpStatus?: number;
  requestId: string;
}

export interface SyncState {
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  stale: boolean;
  lastError?: AdapterError;
}

export interface Preferences {
  enabledSources: SourceId[];
  retentionPerAccount: number;
  freshnessCooldownMs: number;
  /**
   * Accounts selected for manual and automatic sync. An omitted value keeps
   * the legacy/default behavior of syncing every enabled account; an empty
   * array is an intentional "sync nothing" choice.
   */
  syncAccountIds?: string[];
}

export interface StoredData {
  schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  revision: number;
  accounts: AccountConfig[];
  submissions: Submission[];
  syncStates: Record<string, SyncState>;
  preferences: Preferences;
}

export const DEFAULT_PREFERENCES: Preferences = {
  enabledSources: ["codeforces"],
  retentionPerAccount: 2_000,
  freshnessCooldownMs: 2 * 60 * 1_000,
};
