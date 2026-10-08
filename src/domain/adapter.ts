import type {
  AccountConfig,
  AccountAuthMode,
  Availability,
  Diagnostic,
  AccountCredentials,
  InstanceBrandingRecord,
  SourceId,
  Submission,
} from "./types";
import type { SyncWindow } from "./sync-range";
import type { ProgressObserver } from "./sync-progress";
import type { ActivityScheduleRecord } from "./activity-schedule";
import type { PaginationPolicy } from "./pagination-policy";

export interface AdapterMetadata {
  id: SourceId;
  displayName: string;
  availability: Availability;
  authModes: AuthModeDefinition[];
  /** Additional origins used for public data requests by this adapter. */
  dataOrigins?: readonly string[];
}

export interface AuthModeDefinition {
  type: AccountAuthMode;
  recommended?: boolean;
  label?: string;
  description?: string;
  credentialFields?: AuthCredentialField[];
  identifierRequired?: boolean;
  identifierLabel?: string;
}

export interface AuthCredentialField {
  key: string;
  label: string;
  type?: "text" | "password";
  /** Marks a field as a Cookie value for adapters and future UI affordances. */
  credentialType?: "cookie" | "text";
  placeholder?: string;
  required?: boolean;
}

export type BrowserSessionStatus =
  | "authenticated"
  | "unauthenticated"
  | "network-error"
  | "permission-denied"
  | "site-error"
  | "unsupported";

export interface BrowserSessionAccount {
  authenticated: boolean;
  status: BrowserSessionStatus;
  username?: string;
  uid?: string;
  diagnostic?: string;
}

export interface CanonicalAccount {
  accountId: string;
  source: SourceId;
  providerAccountKey: string;
  displayName?: string;
}

/** Context shared by identity checks and submission collection. */
export interface AdapterContext {
  account: AccountConfig;
  /** Credentials are injected by the application for this request only. */
  credentials?: AccountCredentials;
  signal: AbortSignal;
  now: number;
  requestId: string;
  http: HttpClient;
}

/** Identity validation must not depend on submission history or sync windows. */
export type AuthorizeInput = AdapterContext;

export interface PaginationRuntime {
  runPage<T>(input: {
    origin: string;
    signal: AbortSignal;
    request: () => Promise<T>;
    /** Bound by the collection use case; never creates another origin queue. */
    policy?: PaginationPolicy;
  }): Promise<T>;
}

export interface FetchInput extends AdapterContext, SyncWindow {
  limit: number;
  pagination: PaginationRuntime;
  onProgress?: ProgressObserver;
  activitySchedules?: readonly ActivityScheduleRecord[];
  recheckActivities?: boolean;
}

export type PartialReason =
  | "record-limit"
  | "page-limit"
  | "activity-limit"
  | "deadline"
  | "pagination-repeated"
  | "unverified-coverage"
  | "invalid-record"
  | "rate-limited"
  | "unavailable";

export type CoverageOutcome =
  | {
      status: "complete";
      evidence: "exhausted" | "window-boundary" | "all-streams";
    }
  | {
      status: "partial";
      reasons: readonly [PartialReason, ...PartialReason[]];
    };

export interface SyncCoverage {
  window: SyncWindow;
  outcome: CoverageOutcome;
  /** Dispatched logical pages, including failed pages; retries count once. */
  pagesFetched: number;
  /** Unique, in-window records returned by this collection. */
  acceptedRecords: number;
}

export interface FetchResult {
  account: CanonicalAccount;
  records: Submission[];
  diagnostics: Diagnostic[];
  coverage: SyncCoverage;
  activitySchedules?: ActivityScheduleRecord[];
}

export interface BrowserSessionInput {
  signal: AbortSignal;
  requestId: string;
  http: HttpClient;
  origin?: string;
  domainId?: string;
}

export interface OJAdapter {
  readonly metadata: AdapterMetadata;
  authorize(input: AuthorizeInput): Promise<CanonicalAccount>;
  detectBrowserSession?(
    input: BrowserSessionInput,
  ): Promise<BrowserSessionAccount>;
  fetchRecent(input: FetchInput): Promise<FetchResult>;
  fetchInstanceBranding?(input: InstanceMetadataInput): Promise<{
    branding?: InstanceBrandingRecord;
    diagnostics: Diagnostic[];
  }>;
}

export type InstanceMetadataInput = AdapterContext;

export interface HttpRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  credentials?: RequestCredentials;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /** Exact dynamic HydroOJ origin permitted for this request. */
  hydroOrigin?: string;
  /** Permit the read-only AtCoder Problems public API for AtCoder records. */
  atcoderProblemsApi?: boolean;
  atcoderProblemMetadataApi?: boolean;
  /** Permit an individual public AtCoder submission detail page. */
  atcoderSubmissionPage?: boolean;
  /** Temporarily use this AtCoder session for an official-site request. */
  atcoderSessionCookie?: string;
  /** Temporarily use this QOJ Cookie through the browser cookie store. */
  qojCookie?: string;
  /** Temporarily use this Codeforces Cookie through the browser cookie store. */
  codeforcesCookie?: string;
  /** Allow a same-origin login POST to follow its redirect. */
  followRedirects?: boolean;
  responseType?: "text" | "bytes";
}

export interface HttpResponse {
  status: number;
  url: string;
  contentType: string;
  text: string;
  bytes?: Uint8Array;
  headers: Headers;
}

/** Cookie scope information for diagnostics; never contains credential values. */
export interface HttpCookieMetadata {
  name: string;
  domain: string;
  path: string;
  hostOnly: boolean;
  sameSite: string;
  partitionTopLevelSite?: string;
}

export interface HttpClient {
  request(
    source: SourceId,
    url: string,
    options?: HttpRequestOptions,
  ): Promise<HttpResponse>;
  /** Read one browser-managed cookie without exposing its value to UI/logs. */
  getCookie?(
    source: SourceId,
    url: string,
    name: string,
  ): Promise<string | undefined>;
  /** Read the small, source-scoped set of browser cookies needed for auth fallback. */
  getCookies?(source: SourceId, url: string): Promise<Record<string, string>>;
  /** Inspect relevant session cookie scopes without returning their values. */
  getCookieMetadata?(
    source: SourceId,
    url: string,
  ): Promise<HttpCookieMetadata[]>;
}
