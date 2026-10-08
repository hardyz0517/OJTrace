import {
  DEFAULT_PAGINATION_POLICY,
  isPaginationPolicy,
  paginationDelayMs,
  type PaginationPolicy,
  type PaginationRuntime,
} from "../../domain";
import { normalizeRequestOrigin, type RateLimitRegistry } from "./rate-limit";

export interface PaginationRuntimeOptions {
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  rateLimits?: RateLimitRegistry;
  idleTtlMs?: number;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

/** Canceling an idle page delay never leaves a timer or abort listener behind. */
export function sleepForPagination(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

interface OriginQueue {
  tail: Promise<void>;
  hasDispatched: boolean;
  lastUsedAt: number;
  pending: number;
}

/**
 * Serializes whole logical page callbacks. Lock order is instance session ->
 * pagination -> sleep -> request callback -> Cookie scope -> physical HTTP.
 * Callbacks must not re-enter this same origin queue. Abort never releases an
 * active callback until its Cookie/request cleanup has actually settled.
 */
export function createPaginationRuntime(
  options: PaginationRuntimeOptions = {},
): PaginationRuntime {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? sleepForPagination;
  const idleTtlMs = options.idleTtlMs ?? 10 * 60 * 1_000;
  const queues = new Map<string, OriginQueue>();

  return {
    runPage<T>({
      origin,
      signal,
      request,
      policy = DEFAULT_PAGINATION_POLICY,
    }: {
      origin: string;
      signal: AbortSignal;
      request: () => Promise<T>;
      policy?: PaginationPolicy;
    }): Promise<T> {
      if (signal.aborted) return Promise.reject(abortError(signal));
      if (!isPaginationPolicy(policy))
        return Promise.reject(new RangeError("Invalid pagination policy"));
      const snapshot = {
        intervalMs: policy.intervalMs,
        jitterMs: policy.jitterMs,
      };
      let normalized: string;
      try {
        normalized = normalizeRequestOrigin(origin);
      } catch (error) {
        return Promise.reject(error);
      }
      const timestamp = now();
      for (const [key, queue] of queues) {
        if (queue.pending === 0 && timestamp - queue.lastUsedAt >= idleTtlMs)
          queues.delete(key);
      }
      let queue = queues.get(normalized);
      if (!queue) {
        queue = {
          tail: Promise.resolve(),
          hasDispatched: false,
          lastUsedAt: timestamp,
          pending: 0,
        };
        queues.set(normalized, queue);
      }
      const state = queue;
      state.pending += 1;
      let dispatched = false;
      let resolveCaller: (result: T) => void;
      let rejectCaller: (error: unknown) => void;
      const caller = new Promise<T>((resolve, reject) => {
        resolveCaller = resolve;
        rejectCaller = reject;
      });
      const abortQueued = () => {
        // Return promptly for queued/delayed tasks, but keep their internal
        // chain behind the preceding callback so cancellation cannot cut locks.
        if (!dispatched) rejectCaller(abortError(signal));
      };
      signal.addEventListener("abort", abortQueued, { once: true });
      const operation = state.tail.then(async () => {
        try {
          throwIfAborted(signal);
          if (options.rateLimits) await options.rateLimits.ready();
          throwIfAborted(signal);
          options.rateLimits?.assertAvailable(normalized);
          if (state.hasDispatched) {
            await sleep(paginationDelayMs(snapshot, random()), signal);
          }
          throwIfAborted(signal);
          options.rateLimits?.assertAvailable(normalized);
          dispatched = true;
          state.hasDispatched = true;
          const result = await request();
          throwIfAborted(signal);
          resolveCaller(result);
        } catch (error) {
          rejectCaller(error);
        } finally {
          signal.removeEventListener("abort", abortQueued);
          state.pending -= 1;
          state.lastUsedAt = now();
        }
      });
      // Failure is delivered to the caller; the shared queue always continues.
      state.tail = operation;
      return caller;
    },
  };
}
