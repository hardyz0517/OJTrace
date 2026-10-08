import { SOURCE_IDS, type SourceId } from "./types";

export interface PaginationPolicy {
  readonly intervalMs: number;
  /** Symmetric uniform jitter: intervalMs ± jitterMs. Zero disables jitter. */
  readonly jitterMs: number;
}

export const PAGINATION_LIMITS = Object.freeze({
  minIntervalMs: 1_500,
  maxIntervalMs: 600_000,
  minDelayMs: 1_000,
  stepMs: 100,
});

export const DEFAULT_PAGINATION_POLICY: PaginationPolicy = Object.freeze({
  intervalMs: 1_500,
  jitterMs: 500,
});

// Exhaustive: registering a new source requires an explicit default policy.
export const SOURCE_PAGINATION_POLICIES = {
  codeforces: DEFAULT_PAGINATION_POLICY,
  luogu: DEFAULT_PAGINATION_POLICY,
  qoj: DEFAULT_PAGINATION_POLICY,
  atcoder: DEFAULT_PAGINATION_POLICY,
  hydroj: DEFAULT_PAGINATION_POLICY,
} satisfies Record<SourceId, PaginationPolicy>;

export function maxPaginationJitterMs(intervalMs: number): number {
  return Math.max(
    0,
    Math.min(
      PAGINATION_LIMITS.maxIntervalMs,
      intervalMs - PAGINATION_LIMITS.minDelayMs,
    ),
  );
}

export function isPaginationPolicy(value: unknown): value is PaginationPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as Partial<PaginationPolicy>;
  return (
    Object.keys(policy).every(
      (key) => key === "intervalMs" || key === "jitterMs",
    ) &&
    typeof policy.intervalMs === "number" &&
    Number.isSafeInteger(policy.intervalMs) &&
    policy.intervalMs >= PAGINATION_LIMITS.minIntervalMs &&
    policy.intervalMs <= PAGINATION_LIMITS.maxIntervalMs &&
    policy.intervalMs % PAGINATION_LIMITS.stepMs === 0 &&
    typeof policy.jitterMs === "number" &&
    Number.isSafeInteger(policy.jitterMs) &&
    policy.jitterMs >= 0 &&
    policy.jitterMs <= maxPaginationJitterMs(policy.intervalMs) &&
    policy.jitterMs % PAGINATION_LIMITS.stepMs === 0
  );
}

/** Corrupt optional entries fall back independently without losing valid sources. */
export function sanitizePaginationPolicies(
  value: unknown,
): Partial<Record<SourceId, PaginationPolicy>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const overrides: Partial<Record<SourceId, PaginationPolicy>> = {};
  for (const source of SOURCE_IDS) {
    const policy = Object.hasOwn(value, source)
      ? (value as Record<string, unknown>)[source]
      : undefined;
    if (isPaginationPolicy(policy))
      overrides[source] = {
        intervalMs: policy.intervalMs,
        jitterMs: policy.jitterMs,
      };
  }
  return Object.keys(overrides).length ? overrides : undefined;
}

export function resolvePaginationPolicy(
  source: SourceId,
  overrides?: Partial<Record<SourceId, PaginationPolicy>>,
): PaginationPolicy {
  const candidate = overrides?.[source];
  const policy = isPaginationPolicy(candidate)
    ? candidate
    : SOURCE_PAGINATION_POLICIES[source];
  return Object.freeze({
    intervalMs: policy.intervalMs,
    jitterMs: policy.jitterMs,
  });
}

export function paginationDelayMs(
  policy: PaginationPolicy,
  sample: number,
): number {
  const normalized = Number.isFinite(sample)
    ? Math.max(0, Math.min(1, sample))
    : 0.5;
  return Math.round(policy.intervalMs + (normalized * 2 - 1) * policy.jitterMs);
}
