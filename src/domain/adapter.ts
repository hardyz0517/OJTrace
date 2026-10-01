import type {
  AccountConfig,
  AccountAuthMode,
  Availability,
  Diagnostic,
  SourceId,
  Submission,
} from "./types";

export interface AdapterCapabilities {
  accountLookup: boolean;
  stableSubmissionId: boolean;
  directSubmissionUrl: boolean;
  requiresBrowserSession: boolean;
  supportsAnonymous: boolean;
  supportsContentScriptFallback: boolean;
}

export interface AdapterMetadata {
  id: SourceId;
  displayName: string;
  availability: Availability;
  authModes: AuthModeDefinition[];
  capabilities: AdapterCapabilities;
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
  placeholder?: string;
  required?: boolean;
}

export type BrowserSessionStatus =
  | "authenticated"
  | "unauthenticated"
  | "network-error"
  | "permission-denied"
  | "site-error"
  | "browser-cookie-unavailable"
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

export interface FetchInput {
  account: AccountConfig;
  limit: number;
  signal: AbortSignal;
  now: number;
  requestId: string;
  http: HttpClient;
}

export interface FetchResult {
  account: CanonicalAccount;
  records: Submission[];
  diagnostics: Diagnostic[];
  hasMore: boolean;
}

export interface BrowserSessionInput {
  signal: AbortSignal;
  requestId: string;
  http: HttpClient;
  pageIdentity?: string;
  origin?: string;
}

export interface OJAdapter {
  readonly metadata: AdapterMetadata;
  detectBrowserSession?(
    input: BrowserSessionInput,
  ): Promise<BrowserSessionAccount>;
  validateAccount?(input: FetchInput): Promise<CanonicalAccount>;
  fetchRecent(input: FetchInput): Promise<FetchResult>;
}

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
  /** Allow a same-origin login POST to follow its redirect. */
  followRedirects?: boolean;
}

export interface HttpResponse {
  status: number;
  url: string;
  contentType: string;
  text: string;
  headers: Headers;
}

export interface HttpClient {
  request(
    source: SourceId,
    url: string,
    options?: HttpRequestOptions,
  ): Promise<HttpResponse>;
}
