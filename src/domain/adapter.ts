import type {
  AccountConfig,
  AuthMode,
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
  authModes: AuthMode[];
  capabilities: AdapterCapabilities;
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

export interface OJAdapter {
  readonly metadata: AdapterMetadata;
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
