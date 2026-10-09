/** Cancels an idle delay and always removes its timer/listener; never releases task locks. */
export function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
  abortReason = () =>
    signal?.reason ?? new DOMException("Aborted", "AbortError"),
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason());
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(abortReason());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
