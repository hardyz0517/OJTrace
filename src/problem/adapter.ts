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
  readonly captureHints?: ProblemCaptureHints;
  match(url: string): boolean;
  inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined>;
  extract(snapshot: ProblemPageSnapshot): Promise<ProblemExtractionResult>;
}
