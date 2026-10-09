import { afterEach, expect, it, vi } from "vitest";
import { abortableDelay } from "../../src/platform/async/delay";
afterEach(() => vi.useRealTimers());
it("clears delayed timers on abort and preserves the owner's rejection policy", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const reason = { kind: "deadline" };
  const waiting = abortableDelay(100, controller.signal).catch(
    (error: unknown) => error,
  );
  controller.abort(reason);
  expect(await waiting).toBe(reason);
  expect(vi.getTimerCount()).toBe(0);
  await expect(
    abortableDelay(
      100,
      controller.signal,
      () => new DOMException("Aborted", "AbortError"),
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(vi.getTimerCount()).toBe(0);
});
it("supports an absent signal and removes the listener after natural completion", async () => {
  vi.useFakeTimers();
  const signal = new AbortController().signal;
  const remove = vi.spyOn(signal, "removeEventListener");
  const work = Promise.all([abortableDelay(1), abortableDelay(2, signal)]);
  await vi.runAllTimersAsync();
  await work;
  expect(remove).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
