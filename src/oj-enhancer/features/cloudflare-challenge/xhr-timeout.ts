const PATCH_MARKER = "__ojtraceCloudflareChallengeXhrTimeoutPatch";

interface XhrInstance {
  timeout: number;
}

type XhrMethod = (...args: never[]) => unknown;

interface XhrPrototype {
  open: XhrMethod;
  send: XhrMethod;
  [PATCH_MARKER]?: boolean;
}

interface XhrConstructor {
  prototype: XhrPrototype;
}

export interface CloudflareChallengeWindow {
  location: { href: string };
  XMLHttpRequest?: XhrConstructor;
}

/**
 * Cloudflare's challenge iframe uses XHR endpoints under this path. The
 * challenge page itself is the only context where this timeout adjustment is
 * allowed; normal OJ and extension requests are intentionally excluded.
 */
export function isCloudflareChallengeRequest(
  rawUrl: string,
  baseHref: string,
): boolean {
  try {
    const url = new URL(rawUrl, baseHref);
    return (
      url.origin === "https://challenges.cloudflare.com" &&
      url.pathname.startsWith("/cdn-cgi/challenge-platform/")
    );
  } catch {
    return false;
  }
}

function isCloudflareChallengePage(rawUrl: string): boolean {
  return isCloudflareChallengeRequest(rawUrl, rawUrl);
}

/**
 * Remove the browser-side XHR timeout used by the Cloudflare challenge.
 * Returns false when the page does not expose a patchable XHR constructor or
 * when this document has already been patched.
 */
export function installCloudflareChallengeXhrTimeoutPatch(
  page: CloudflareChallengeWindow,
): boolean {
  if (!isCloudflareChallengePage(page.location.href)) return false;
  const xhr = page.XMLHttpRequest;
  if (!xhr) return false;

  const prototype = xhr.prototype;
  if (
    !prototype ||
    typeof prototype.open !== "function" ||
    typeof prototype.send !== "function" ||
    prototype[PATCH_MARKER]
  )
    return false;

  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  const requestUrls = new WeakMap<object, string>();

  prototype.open = function (this: XhrInstance, ...args: unknown[]) {
    const rawUrl = args[1];
    if (rawUrl !== undefined && rawUrl !== null)
      requestUrls.set(this, String(rawUrl));
    else requestUrls.delete(this);
    return Reflect.apply(originalOpen, this, args);
  };

  prototype.send = function (this: XhrInstance, ...args: unknown[]) {
    const rawUrl = requestUrls.get(this);
    if (rawUrl && isCloudflareChallengeRequest(rawUrl, page.location.href)) {
      // XHR's WebIDL conversion treats undefined as 0, but assigning the
      // documented numeric value is clearer and works across browsers.
      try {
        this.timeout = 0;
      } catch {
        // A host may expose a read-only XHR shim; leave that request intact.
      }
    }
    return Reflect.apply(originalSend, this, args);
  };

  prototype[PATCH_MARKER] = true;
  return true;
}
