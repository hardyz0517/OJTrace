import { codeforcesAdapter } from "./codeforces";
import { qojAdapter } from "./qoj";
import { luoguAdapter } from "./luogu";
import { atcoderAdapter } from "./atcoder";
import { hydroOJAdapter } from "./hydroj";

export const adapters = [
  codeforcesAdapter,
  luoguAdapter,
  qojAdapter,
  atcoderAdapter,
  hydroOJAdapter,
];

export const adapterBySource = new Map(
  adapters.map((adapter) => [adapter.metadata.id, adapter]),
);
