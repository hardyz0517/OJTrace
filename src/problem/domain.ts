import type { SourceId } from "../domain/types";
import { sourceDefinitions } from "../sources/definitions";
import type { MarkdownRoot } from "./markdown/ast";

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

interface ProblemJsonSource {
  key: string;
  path: readonly string[];
  fields: readonly string[];
  /** Match the current problem id, ignoring the casing used in bank routes. */
  identity?: { field: string; value: string };
}

/** Declarative page sources. Capture copies only the Adapter's allowlisted JSON. */
export interface ProblemCaptureHints {
  jsonScripts?: readonly (ProblemJsonSource & { selector: string })[];
  /** Same-page JSON fallback when initial scripts are absent or belong to a previous SPA route. */
  jsonRequest?: ProblemJsonSource & {
    headers: Readonly<Record<string, string>>;
  };
}

export interface ProblemPageSnapshot {
  url: string;
  title: string;
  html: string;
  baseUrl: string;
  language?: ProblemLanguage;
  /** Allowlisted statement fields from page JSON or its same-origin native response. */
  sourceData?: Readonly<Record<string, unknown>>;
  /** Images captured from the live page, when same-origin/CORS permits. */
  imageAssets?: readonly ProblemAsset[];
  /** Non-fatal image capture failures retained for renderer/UI diagnostics. */
  imageWarnings?: readonly ProblemWarning[];
  capturedAt: number;
}

export interface ProblemLimit {
  readonly display: string;
  readonly milliseconds?: number;
  readonly bytes?: number;
}

export interface ProblemAsset {
  readonly sourceUrl: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly dataUrl?: string;
  readonly mimeType?: string;
  /** Renderer-private virtual path, populated only for an embedded asset. */
  readonly typstPath?: string;
}

export interface ProblemWarning {
  readonly code: string;
  readonly message: string;
}

export interface ProblemPreview {
  oj: SourceId;
  ojDisplayName: string;
  problemId: string;
  title: string;
  originalUrl: string;
  language?: ProblemLanguage;
}

export interface ProblemMetadata {
  readonly oj: SourceId;
  readonly problemId: string;
  readonly title: string;
  readonly originalUrl: string;
  readonly timeLimit?: ProblemLimit;
  readonly memoryLimit?: ProblemLimit;
  readonly language?: ProblemLanguage;
}

/** A rendering value derived entirely from the current final Markdown. */
export interface RenderDocument extends ProblemMetadata {
  readonly ast: MarkdownRoot;
  readonly assets: readonly ProblemAsset[];
  readonly warnings: readonly ProblemWarning[];
  displayLabels?: {
    readonly timeLimit: string;
    readonly memoryLimit: string;
    readonly page?: {
      readonly prefix: string;
      readonly suffix: string;
      readonly totalPrefix: string;
      readonly totalSuffix: string;
    };
  };
}

export interface SourceProblem {
  readonly metadata: ProblemMetadata;
  readonly sourceMarkdown: string;
  readonly assets: readonly ProblemAsset[];
  readonly warnings: readonly ProblemWarning[];
}
export interface CnoiProblem {
  readonly cnoiMarkdown: string;
  readonly assets: readonly ProblemAsset[];
  readonly warnings: readonly ProblemWarning[];
}

export type ProblemExtractionResult =
  | { ok: true; source: SourceProblem }
  | {
      ok: false;
      reason: ProblemFailureReason;
      message?: string;
    };

export function problemDisplayName(source: SourceId): string {
  return sourceDefinitions[source].metadata.displayName;
}
