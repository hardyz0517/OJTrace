import { codeforcesAdapter } from "./codeforces";
import { lojAdapter, qojAdapter } from "./unsupported";
import { luoguAdapter } from "./luogu";

export const adapters = [
  codeforcesAdapter,
  luoguAdapter,
  qojAdapter,
  lojAdapter,
];

export const adapterBySource = new Map(
  adapters.map((adapter) => [adapter.metadata.id, adapter]),
);
