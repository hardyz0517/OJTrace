/** Observe Luogu SPA navigation across static and late-injected scripts. */
export function watchLuoguLocationChanges(onChange: () => void): () => void {
  let lastUrl = location.href;
  const notify = (): void => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    onChange();
  };
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
  window.addEventListener("wxt:locationchange", notify);
  // MAIN-world pushState is not observable from a late-injected isolated script.
  const poll = window.setInterval(notify, 200);
  return () => {
    window.clearInterval(poll);
    window.removeEventListener("popstate", notify);
    window.removeEventListener("hashchange", notify);
    window.removeEventListener("wxt:locationchange", notify);
  };
}
