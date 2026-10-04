export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 2 * 60 * 1_000;

export interface RateLimitEntry {
  origin: string;
  blockedUntil: number;
}

/** Persistence belongs to the background composition root, not this module. */
export interface RateLimitStorage {
  load(): Promise<readonly RateLimitEntry[] | undefined>;
  save(entries: readonly RateLimitEntry[]): Promise<void>;
}

export interface RateLimitRegistryOptions {
  now?: () => number;
  defaultCooldownMs?: number;
  storage?: RateLimitStorage;
  onStorageError?: (error: unknown) => void;
}

export function normalizeRequestOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new TypeError("Expected an HTTP origin without credentials");
  }
  return url.origin;
}

/** Retry-After delta seconds or HTTP date; an invalid header has no value. */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number,
): number | undefined {
  const header = value?.trim();
  if (!header) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(header)) {
    const milliseconds = Number(header) * 1_000;
    return Number.isFinite(milliseconds) &&
      milliseconds <= Number.MAX_SAFE_INTEGER
      ? Math.ceil(milliseconds)
      : undefined;
  }
  // Date.parse accepts unrelated numeric strings; require an HTTP-date shape.
  if (!/^[A-Za-z]{3},?\s/.test(header)) return undefined;
  const timestamp = Date.parse(header);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined;
}

export class RateLimitError extends Error {
  readonly code = "rate_limited";
  readonly httpStatus = 429;

  constructor(public readonly retryAfterMs: number) {
    super("Request origin is cooling down after rate limiting");
    this.name = "RateLimitError";
  }
}

/** One source of cooldown truth for all requests to the same real origin. */
export class RateLimitRegistry {
  private readonly entries = new Map<string, number>();
  private readonly now: () => number;
  private readonly defaultCooldownMs: number;
  private restorePromise?: Promise<void>;
  private writeTail = Promise.resolve();

  constructor(private readonly options: RateLimitRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.defaultCooldownMs =
      options.defaultCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  }

  /** All task owners share this one restore promise. Failures keep memory safe. */
  ready(): Promise<void> {
    this.restorePromise ??= this.restore();
    return this.restorePromise;
  }

  private async restore(): Promise<void> {
    if (!this.options.storage) return;
    try {
      const entries = await this.options.storage.load();
      for (const entry of entries ?? []) {
        if (
          !entry ||
          typeof entry.origin !== "string" ||
          !Number.isSafeInteger(entry.blockedUntil) ||
          entry.blockedUntil <= this.now()
        )
          continue;
        let origin: string;
        try {
          origin = normalizeRequestOrigin(entry.origin);
        } catch {
          continue;
        }
        this.entries.set(
          origin,
          Math.max(this.entries.get(origin) ?? 0, entry.blockedUntil),
        );
      }
    } catch (error) {
      this.reportStorageError(error);
    }
  }

  getRetryAfterMs(origin: string): number {
    const normalized = normalizeRequestOrigin(origin);
    const remaining = Math.max(
      0,
      (this.entries.get(normalized) ?? 0) - this.now(),
    );
    if (remaining === 0) this.entries.delete(normalized);
    return remaining;
  }

  assertAvailable(origin: string): void {
    const remaining = this.getRetryAfterMs(origin);
    if (remaining > 0) throw new RateLimitError(remaining);
  }

  /** Synchronously block subsequent dispatch before any parsing or storage IO. */
  record429(origin: string, retryAfter?: string | null): number {
    const normalized = normalizeRequestOrigin(origin);
    const now = this.now();
    const requested =
      parseRetryAfter(retryAfter, now) ?? this.defaultCooldownMs;
    const blockedUntil = Math.min(Number.MAX_SAFE_INTEGER, now + requested);
    this.entries.set(
      normalized,
      Math.max(this.entries.get(normalized) ?? 0, blockedUntil),
    );
    this.persist();
    return this.getRetryAfterMs(normalized);
  }

  private persist(): void {
    if (!this.options.storage) return;
    this.writeTail = this.writeTail.then(async () => {
      await this.ready();
      const now = this.now();
      const snapshot: RateLimitEntry[] = [];
      for (const [origin, blockedUntil] of this.entries) {
        if (blockedUntil > now) snapshot.push({ origin, blockedUntil });
        else this.entries.delete(origin);
      }
      try {
        // Take the current snapshot when the write starts: queued older states
        // can never overwrite a newer cooldown, and writes never overlap.
        await this.options.storage!.save(snapshot);
      } catch (error) {
        this.reportStorageError(error);
      }
    });
  }

  private reportStorageError(error: unknown): void {
    try {
      this.options.onStorageError?.(error);
    } catch {
      // Diagnostics cannot disable cooldown enforcement or poison writeTail.
    }
  }

  async flush(): Promise<void> {
    await this.ready();
    await this.writeTail;
  }
}

export function createRateLimitRegistry(
  options?: RateLimitRegistryOptions,
): RateLimitRegistry {
  return new RateLimitRegistry(options);
}
