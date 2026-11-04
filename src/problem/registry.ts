import { PROBLEM_SNAPSHOT_HTML_LIMIT } from "./budget";
import type {
  ProblemExtractionResult,
  ProblemPageProbe,
  ProblemPageSnapshot,
  ProblemPreview,
  ProblemCaptureHints,
} from "./domain";
import type { ProblemAdapter } from "./adapter";
import { atcoderProblemAdapter } from "./adapters/atcoder";
import { codeforcesProblemAdapter } from "./adapters/codeforces";
import { hydrojProblemAdapter } from "./adapters/hydroj";
import { luoguProblemAdapter } from "./adapters/luogu";
import { qojProblemAdapter } from "./adapters/qoj";

const problemAdapters: readonly ProblemAdapter[] = [
  codeforcesProblemAdapter,
  atcoderProblemAdapter,
  qojProblemAdapter,
  luoguProblemAdapter,
  hydrojProblemAdapter,
];

class ProblemAdapterRegistry {
  constructor(readonly adapters: readonly ProblemAdapter[] = problemAdapters) {}

  find(url: string): ProblemAdapter | undefined {
    return this.adapters.find((adapter) => adapter.match(url));
  }

  captureHints(url: string): ProblemCaptureHints | undefined {
    return this.find(url)?.captureHints?.(url);
  }

  async inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined> {
    for (const adapter of this.adapters) {
      if (!adapter.match(probe.url)) continue;
      const result = await adapter.inspect(probe);
      if (result) return result;
    }
    return undefined;
  }

  async extractSource(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult> {
    const adapter = this.find(snapshot.url);
    if (!adapter) return { ok: false, reason: "unsupported-url" };
    if (snapshot.html.length > PROBLEM_SNAPSHOT_HTML_LIMIT)
      return { ok: false, reason: "size-limit" };
    try {
      return await adapter.extractSource(snapshot);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof RangeError ? "size-limit" : "invalid-snapshot",
      };
    }
  }
}

export const problemAdapterRegistry = new ProblemAdapterRegistry();
