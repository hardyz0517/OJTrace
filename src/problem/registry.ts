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

export const problemAdapters: readonly ProblemAdapter[] = [
  codeforcesProblemAdapter,
  atcoderProblemAdapter,
  qojProblemAdapter,
  luoguProblemAdapter,
  hydrojProblemAdapter,
];

export class ProblemAdapterRegistry {
  constructor(readonly adapters: readonly ProblemAdapter[] = problemAdapters) {}

  find(url: string): ProblemAdapter | undefined {
    return this.adapters.find((adapter) => adapter.match(url));
  }

  captureHints(url: string): ProblemCaptureHints | undefined {
    return this.find(url)?.captureHints;
  }

  async inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined> {
    for (const adapter of this.adapters) {
      if (!adapter.match(probe.url)) continue;
      const result = await adapter.inspect(probe);
      if (result) return result;
    }
    return undefined;
  }

  async extract(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult> {
    const adapter = this.find(snapshot.url);
    if (!adapter) return { ok: false, reason: "unsupported-url" };
    return adapter.extract(snapshot);
  }
}

export const problemAdapterRegistry = new ProblemAdapterRegistry();

export async function inspectProblemPage(
  probe: ProblemPageProbe,
): Promise<ProblemPreview | undefined> {
  return problemAdapterRegistry.inspect(probe);
}

export async function extractProblemPage(
  snapshot: ProblemPageSnapshot,
): Promise<ProblemExtractionResult> {
  return problemAdapterRegistry.extract(snapshot);
}
