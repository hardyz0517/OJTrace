/** Shared markers for the hash-based Luogu record enhancement route. */

export const LUOGU_CROSS_OJ_RECORD_ROUTE_EVENT = "ojtrace:luogu-record-route";
export const LUOGU_CROSS_OJ_RECORD_ROUTE_MESSAGE_SOURCE =
  "ojtrace-luogu-record-route";
export const LUOGU_CROSS_OJ_RECORD_ROUTE_ADOPT_SOURCE =
  "ojtrace-luogu-record-route-adopt";
export const LUOGU_CROSS_OJ_RECORD_MAIN_ATTRIBUTE =
  "data-ojtrace-luogu-record-main";
export const LUOGU_CROSS_OJ_RECORD_PAGE_ATTRIBUTE =
  "data-ojtrace-luogu-record-page";
export const LUOGU_CROSS_OJ_RECORD_ROUTE_KEY_ATTRIBUTE =
  "data-ojtrace-luogu-record-route";
/**
 * A DOM-visible ownership marker shared by all Luogu content-script worlds.
 *
 * Static content scripts and a late scripting.executeScript bootstrap do not
 * reliably share a JavaScript singleton, but they do share the document.  The
 * marker lets a newer controller take over without leaving an older renderer
 * alive in the same page.
 */
export const LUOGU_CROSS_OJ_CONTROLLER_ATTRIBUTE =
  "data-ojtrace-luogu-controller";
export const LUOGU_CROSS_OJ_CONTROLLER_TAKEOVER_EVENT =
  "ojtrace:luogu-controller-takeover";
