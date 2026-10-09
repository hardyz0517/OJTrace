import { codeforcesAdapter } from "./codeforces";
import { qojAdapter } from "./qoj";
import { luoguAdapter } from "./luogu";
import { atcoderAdapter } from "./atcoder";
import { hydroOJAdapter } from "./hydroj";
import { SOURCE_IDS, type OJAdapter, type SourceId } from "../domain";

export const adapterRegistry = {
  codeforces: codeforcesAdapter,
  luogu: luoguAdapter,
  qoj: qojAdapter,
  atcoder: atcoderAdapter,
  hydroj: hydroOJAdapter,
} satisfies Record<SourceId, OJAdapter>;

for (const source of SOURCE_IDS) {
  if (adapterRegistry[source].metadata.id !== source) {
    throw new Error(`Adapter registry identity mismatch: ${source}`);
  }
}
