import type { SourceId } from "../domain/types";
import { sourceDefinitions } from "../sources/definitions";
import type { StatementBlock } from "./statement";

export type ProblemLanguage = "zh" | "en" | "ja" | "other";

export type ProblemFailureReason =
  | "unsupported-url"
  | "statement-not-found"
  | "login-required"
  | "challenge-page"
  | "page-not-ready"
  | "ambiguous-problem"
  | "size-limit"
  | "invalid-snapshot";

export interface ProblemPageProbe {
  url: string;
  title: string;
  htmlFragment: string;
  baseUrl: string;
}

/** Declarative page sources. Adapters own selectors; capture only copies JSON. */
export interface ProblemCaptureHints {
  jsonScripts?: readonly {
    selector: string;
    key: string;
    path: readonly string[];
    fields: readonly string[];
  }[];
}

export interface ProblemPageSnapshot {
  url: string;
  title: string;
  html: string;
  baseUrl: string;
  language?: ProblemLanguage;
  /** Allowlisted statement source fields copied from page-owned JSON scripts. */
  sourceData?: Readonly<Record<string, unknown>>;
  /** Images captured from the live page, when same-origin/CORS permits. */
  imageAssets?: readonly ProblemAsset[];
  /** Non-fatal image capture failures retained for renderer/UI diagnostics. */
  imageWarnings?: readonly ProblemWarning[];
  capturedAt: number;
}

export interface ProblemLimit {
  display: string;
  milliseconds?: number;
  bytes?: number;
}

export interface ProblemAsset {
  sourceUrl: string;
  alt?: string;
  width?: number;
  height?: number;
  dataUrl?: string;
  mimeType?: string;
  /** Renderer-private virtual path, populated only for an embedded asset. */
  typstPath?: string;
}

export interface ProblemWarning {
  code: string;
  message: string;
}

export interface ProblemPreview {
  oj: SourceId;
  ojDisplayName: string;
  problemId: string;
  title: string;
  originalUrl: string;
  language?: ProblemLanguage;
}

export interface ProblemDocument {
  oj: SourceId;
  problemId: string;
  title: string;
  originalUrl: string;
  timeLimit?: ProblemLimit;
  memoryLimit?: ProblemLimit;
  blocks: readonly StatementBlock[];
  markdown: string;
  language?: ProblemLanguage;
  assets: readonly ProblemAsset[];
  warnings: readonly ProblemWarning[];
}

export interface StatementFragment {
  rootHtml: string;
  title?: string;
  metadataNodes?: readonly string[];
  language?: ProblemLanguage;
}

export type ProblemExtractionResult =
  | { ok: true; document: ProblemDocument }
  | {
      ok: false;
      reason: ProblemFailureReason;
      message?: string;
    };

export function problemDisplayName(source: SourceId): string {
  return sourceDefinitions[source].metadata.displayName;
}
