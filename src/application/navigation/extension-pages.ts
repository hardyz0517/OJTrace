import type { ProblemExportJob } from "../problem-export/export-state";

/** Navigation helpers for extension-owned pages.
 *
 * Keeping this in a small application module means popup and background use
 * the same focus-or-open behaviour without coupling either surface to a
 * particular entrypoint URL.
 */

function pageUrl(path: string): string {
  // WXT's generated runtime type narrows getURL to known entrypoints. Resolve
  // relative to an existing extension page so future entrypoints keep the
  // same navigation helper without widening browser API types.
  return new URL(
    path.replace(/^\//, ""),
    browser.runtime.getURL("/timeline.html"),
  ).href;
}

export async function openOrFocusExtensionPage(path: string): Promise<void> {
  const url = pageUrl(path);
  const tabs = await browser.tabs.query({ url });
  const existing = tabs.find((tab) => typeof tab.id === "number");
  if (existing?.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await browser.tabs.create({ url });
}

export function openOrFocusTimeline(): Promise<void> {
  return openOrFocusExtensionPage("timeline.html");
}

export function openOrFocusSettings(): Promise<void> {
  return openOrFocusExtensionPage("settings.html");
}

export function openProblemExportPage(job: ProblemExportJob): Promise<void> {
  const url = new URL(pageUrl("problem-export.html"));
  // Keep the short-lived hand-off metadata in the page URL as a recovery
  // channel. The statement itself never crosses this boundary.
  url.searchParams.set("token", job.token);
  url.searchParams.set("tabId", String(job.tabId));
  url.searchParams.set("expectedUrl", job.expectedUrl);
  url.searchParams.set("createdAt", String(job.createdAt));
  url.searchParams.set("expiresAt", String(job.expiresAt));
  return browser.tabs.create({ url: url.toString() }).then(() => undefined);
}
