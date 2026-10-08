import type { ActivityScheduleRecord } from "./activity-schedule";
import type { PaginationPolicy } from "./pagination-policy";

export const STORAGE_SCHEMA_VERSION = 2 as const;
export const MESSAGE_SCHEMA_VERSION = 2 as const;

export const SOURCE_IDS = [
  "codeforces",
  "luogu",
  "qoj",
  "atcoder",
  "hydroj",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];
export function isSourceId(value: unknown): value is SourceId {
  return (
    typeof value === "string" && SOURCE_IDS.some((source) => source === value)
  );
}
export type Availability = "stable" | "experimental" | "unsupported";
export type AccountAuthMode =
  "public-handle" | "browser-session" | "manual-cookie" | "password";
export type AccountCredentials = Record<string, string>;
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
  /** Authorization input only; persisted identity uses providerAccountKey. */
  identifier?: string;
  /** User-facing instance name for HydroOJ; defaults to HydroOJ. */
  label?: string;
  enabled: boolean;
  authMode: AccountAuthMode;
  /** Exact HydroOJ instance origin, required for HydroOJ accounts. */
  origin?: string;
  /** Explicit Hydro internal domain; omitted means the host's default domain. */
  domainId?: string;
  providerAccountKey?: string;
  providerDisplayName?: string;
  identityKey?: string;
  verifiedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  credentialRevision?: number;
}

/** Canonical persisted account model contains neither form input nor credentials. */
export interface AccountRecord extends Omit<
  AccountConfig,
  | "identifier"
  | "providerAccountKey"
  | "identityKey"
  | "verifiedAt"
  | "createdAt"
  | "updatedAt"
  | "credentialRevision"
> {
  providerAccountKey: string;
  identityKey: string;
  verifiedAt: number;
  createdAt: number;
  updatedAt: number;
  credentialRevision: number;
}

/** Credentials are persisted separately from account summaries. */
export interface CredentialRecord {
  accountId: string;
  credentials: AccountCredentials;
  updatedAt: number;
}

export interface Submission {
  source: SourceId;
  accountId: string;
  providerAccountKey?: string;
  origin?: string;
  domainId?: string;
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
  activityId?: string;
  activityName?: string;
  activityType?: "contest" | "homework" | "other";
  activityUrl?: string;
  fetchedAt: number;
}

export interface Diagnostic {
  source: SourceId;
  code: string;
  severity: "info" | "warning" | "error";
  messageKey: string;
  retryable: boolean;
  context?: {
    activityId?: string;
    activityName?: string;
    status?: string;
  };
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
  /** Remaining origin cooldown supplied by the transport layer. */
  retryAfterMs?: number;
  requestId: string;
}

export interface SyncState {
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  stale: boolean;
  lastError?: AdapterError;
}

export interface Preferences {
  retentionPerAccount: number;
  freshnessCooldownMs: number;
  /** Only user overrides; missing sources inherit their default pagination policy. */
  paginationBySource?: Partial<Record<SourceId, PaginationPolicy>>;
  /**
   * Accounts selected for manual and automatic sync. An omitted value keeps
   * the default behavior of syncing every enabled account; an empty
   * array is an intentional "sync nothing" choice.
   */
  syncAccountIds?: string[];
  /** The date/time window used by the Timeline's manual sync action. */
  syncRange?: SyncRangePreference;
}

export type SyncRangePreset = "today" | 1 | 7 | 14 | 30;

export interface SyncRangePreference {
  from: number;
  to: number;
  followNow: boolean;
  preset?: SyncRangePreset;
}

export interface StoredData {
  schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  revision: number;
  accounts: AccountRecord[];
  credentials: CredentialRecord[];
  instanceBranding: Record<string, InstanceBrandingRecord>;
  activitySchedules: Record<string, ActivityScheduleRecord>;
  submissions: Submission[];
  syncStates: Record<string, SyncState>;
  preferences: Preferences;
}

export interface InstanceBrandingRecord {
  source: SourceId;
  origin: string;
  domainId?: string;
  name: string;
  iconDataUrl?: string;
  fetchedAt: number;
  iconFetchedAt?: number;
}

/** Includes queue waits, pagination delays, requests and optional enrichment. */
export const ACCOUNT_COLLECTION_DEADLINE_MS = 15 * 60 * 1_000;

export const DEFAULT_PREFERENCES: Preferences = {
  retentionPerAccount: 2_000,
  freshnessCooldownMs: 2 * 60 * 1_000,
};
