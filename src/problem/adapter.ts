import type {
  ProblemExtractionResult,
  ProblemPageProbe,
  ProblemPageSnapshot,
  ProblemPreview,
  ProblemCaptureHints,
} from "./domain";
import type { SourceId } from "../domain/types";

export interface ProblemAdapter {
  readonly oj: SourceId;
  captureHints?(url: string): ProblemCaptureHints;
  match(url: string): boolean;
  inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined>;
  extractSource(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult>;
}
