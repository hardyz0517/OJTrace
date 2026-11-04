const ACCESS_RETRY_DELAYS_MS = [250, 750, 2_000, 5_000] as const;

interface PageAccessState {
  allowed: boolean;
  pending: boolean;
  retryCount: number;
  retryTimer?: ReturnType<typeof setTimeout>;
}

export interface LuoguPageAccessGate {
  hasAccess(key: string): boolean;
  check(
    key: string,
    verify: () => Promise<boolean>,
    isCurrent: () => boolean,
    onSettled: () => void,
  ): void;
  dispose(): void;
}

/** Deduplicates page permission checks and retries transient first-load misses. */
export function createLuoguPageAccessGate(): LuoguPageAccessGate {
  const states = new Map<string, PageAccessState>();
  let activeKey: string | undefined;
  let disposed = false;

  function clearState(state: PageAccessState): void {
    if (state.retryTimer !== undefined) clearTimeout(state.retryTimer);
    state.retryTimer = undefined;
  }

  function activate(key: string): void {
    if (activeKey === key) return;
    for (const state of states.values()) clearState(state);
    states.clear();
    activeKey = key;
  }

  function scheduleRetry(
    key: string,
    state: PageAccessState,
    isCurrent: () => boolean,
    onSettled: () => void,
  ): void {
    const delay =
      ACCESS_RETRY_DELAYS_MS[
        Math.min(state.retryCount, ACCESS_RETRY_DELAYS_MS.length - 1)
      ];
    state.retryCount += 1;
    state.retryTimer = setTimeout(() => {
      state.retryTimer = undefined;
      if (disposed || activeKey !== key || !isCurrent()) return;
      onSettled();
    }, delay);
  }

  return {
    hasAccess(key) {
      return states.get(key)?.allowed ?? false;
    },
    check(key, verify, isCurrent, onSettled) {
      if (disposed) return;
      activate(key);
      let state = states.get(key);
      if (!state) {
        state = { allowed: false, pending: false, retryCount: 0 };
        states.set(key, state);
      }
      if (state.allowed || state.pending || state.retryTimer !== undefined)
        return;

      state.pending = true;
      void Promise.resolve()
        .then(verify)
        .then(
          (allowed) => {
            if (disposed || activeKey !== key || !isCurrent()) return;
            if (allowed) {
              state.allowed = true;
              state.retryCount = 0;
            } else {
              scheduleRetry(key, state, isCurrent, onSettled);
            }
          },
          () => {
            if (!disposed && activeKey === key && isCurrent())
              scheduleRetry(key, state, isCurrent, onSettled);
          },
        )
        .finally(() => {
          state.pending = false;
          if (!disposed) onSettled();
        });
    },
    dispose() {
      disposed = true;
      for (const state of states.values()) clearState(state);
      states.clear();
      activeKey = undefined;
    },
  };
}
