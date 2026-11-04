import {
  observeLuoguSolutionChannelChanges,
  reconcileLuoguSolutionChannelBadge,
} from "../src/oj-enhancer/features/solution-channel/luogu-page-entry";
import { OJTRACE_STORAGE_KEY } from "../src/application/storage/storage-keys";

export default defineContentScript({
  matches: ["https://www.luogu.com.cn/problem/*"],
  main(ctx) {
    if (
      window.top !== window ||
      document.documentElement.dataset.ojtraceSolutionChannel === "active"
    )
      return;
    document.documentElement.dataset.ojtraceSolutionChannel = "active";

    let enabled: boolean | undefined;
    let disposed = false;
    let retryTimer: number | undefined;
    let reconcileFrame: number | undefined;
    let disconnectObservers: () => void = () => undefined;

    const reconcile = (attempt = 0) => {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      if (disposed || !enabled) return;
      const problemPath = /^\/problem\/([^/]+)\/?$/.exec(location.pathname);
      if (
        !problemPath ||
        ["list", "new", "edit"].includes(problemPath[1]!.toLowerCase())
      ) {
        disconnectObservers();
        disconnectObservers = () => undefined;
        document
          .querySelector("[data-ojtrace-luogu-solution-channel]")
          ?.remove();
        return;
      }
      reconcileLuoguSolutionChannelBadge(document, location.pathname);
      disconnectObservers();
      disconnectObservers =
        observeLuoguSolutionChannelChanges(scheduleReconcile);
      const problemState = document.querySelector<HTMLScriptElement>(
        'script#lentille-context[type="application/json"]',
      )?.textContent;
      const tagCardFound = document.querySelector(".tags") !== null;
      if (!problemState || !tagCardFound) {
        if (attempt < 5) {
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(
            () => reconcile(attempt + 1),
            [100, 250, 500, 1_000, 2_000][attempt],
          );
        }
      }
    };

    function scheduleReconcile(): void {
      if (disposed || !enabled || reconcileFrame !== undefined) return;
      reconcileFrame = window.requestAnimationFrame(() => {
        reconcileFrame = undefined;
        reconcile();
      });
    }

    const setEnabled = (value: boolean) => {
      if (enabled === value) return;
      enabled = value;
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      if (reconcileFrame !== undefined) {
        window.cancelAnimationFrame(reconcileFrame);
        reconcileFrame = undefined;
      }
      if (enabled) reconcile();
      else {
        disconnectObservers();
        disconnectObservers = () => undefined;
        document
          .querySelector("[data-ojtrace-luogu-solution-channel]")
          ?.remove();
      }
    };

    const readEnabledPreference = async () => {
      try {
        const stored = await browser.storage.local.get(OJTRACE_STORAGE_KEY);
        const preferences = (
          stored[OJTRACE_STORAGE_KEY] as
            | { preferences?: { luoguSolutionChannelEnabled?: unknown } }
            | undefined
        )?.preferences;
        setEnabled(
          typeof preferences?.luoguSolutionChannelEnabled === "boolean"
            ? preferences.luoguSolutionChannelEnabled
            : true,
        );
      } catch {
        setEnabled(true);
      }
    };
    const onStorageChanged = (
      changes: Record<string, unknown>,
      area: string,
    ) => {
      if (area !== "local" || !Object.hasOwn(changes, OJTRACE_STORAGE_KEY))
        return;
      void readEnabledPreference();
    };

    ctx.addEventListener(window, "hashchange", scheduleReconcile);
    ctx.addEventListener(window, "popstate", scheduleReconcile);
    ctx.addEventListener(window, "wxt:locationchange", scheduleReconcile);
    browser.storage.onChanged.addListener(onStorageChanged);
    ctx.onInvalidated(() => {
      disposed = true;
      window.clearTimeout(retryTimer);
      if (reconcileFrame !== undefined)
        window.cancelAnimationFrame(reconcileFrame);
      disconnectObservers();
      browser.storage.onChanged.removeListener(onStorageChanged);
      delete document.documentElement.dataset.ojtraceSolutionChannel;
      document.querySelector("[data-ojtrace-luogu-solution-channel]")?.remove();
    });
    void readEnabledPreference();
  },
});
