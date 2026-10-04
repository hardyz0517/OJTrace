import { normalizeCookieHeader } from "../../domain";

const queues = new Map<string, Promise<unknown>>();

/** Stable, value-free transport details suitable for session diagnostics. */
export class CookieTransportError extends Error {
  readonly code: string;

  constructor(
    stage: "read" | "injection" | "restoration",
    public readonly cookieName: string,
    cause?: unknown,
  ) {
    super(`Cookie ${stage} failed; name=${cookieName}`, { cause });
    this.name = "CookieTransportError";
    this.code = `cookie-${stage}`;
  }
}

/** All browser requests to an origin wait for temporary Cookie restoration. */
export function withCookieScope<T>(
  origin: string,
  task: () => Promise<T>,
): Promise<T> {
  const operation = (queues.get(origin) ?? Promise.resolve())
    .catch(() => undefined)
    .then(task);
  queues.set(origin, operation);
  void operation
    .finally(() => {
      if (queues.get(origin) === operation) queues.delete(origin);
    })
    .catch(() => undefined);
  return operation;
}

/** Caller holds the origin queue and has checked the exact request scope. */
export async function withTemporaryCookies<T>(
  origin: string,
  raw: string,
  task: () => Promise<T>,
): Promise<T> {
  const normalized = normalizeCookieHeader(raw);
  if (!normalized) throw new Error("Cookie is invalid");
  const url = new URL("/", origin).href;
  const entries = normalized.split("; ").map((pair) => {
    const index = pair.indexOf("=");
    return { name: pair.slice(0, index), value: pair.slice(index + 1) };
  });
  const previous = await Promise.all(
    entries.map(async (entry) => {
      try {
        return await browser.cookies.get({ url, name: entry.name });
      } catch (error) {
        throw new CookieTransportError("read", entry.name, error);
      }
    }),
  );
  const injected: number[] = [];
  let outcome: { value: T } | { error: unknown };
  try {
    const secure = new URL(origin).protocol === "https:";
    for (const [index, entry] of entries.entries()) {
      const old = previous[index];
      const hostCookie = entry.name.startsWith("__Host-");
      let result;
      try {
        result = await browser.cookies.set({
          url,
          name: entry.name,
          value: entry.value,
          // __Host- cookies are required to be host-only, Secure and Path=/.
          // Do not reuse a domain field even if a browser implementation omits
          // the hostOnly flag from cookies.get().
          path: hostCookie ? "/" : (old?.path ?? "/"),
          ...(old && !hostCookie && !old.hostOnly
            ? { domain: old.domain }
            : {}),
          secure,
          httpOnly: old?.httpOnly ?? true,
          // Extension service-worker requests are cross-site relative to the
          // target OJ. A temporary HTTPS cookie must therefore be sent with
          // SameSite=None; the original attribute is restored after the task.
          sameSite: secure ? "no_restriction" : (old?.sameSite ?? "lax"),
          storeId: old?.storeId,
        });
      } catch (error) {
        throw new CookieTransportError("injection", entry.name, error);
      }
      if (!result) throw new CookieTransportError("injection", entry.name);
      injected.push(index);
    }
    outcome = { value: await task() };
  } catch (error) {
    outcome = { error };
  }
  // Restore every injected field even if one restoration fails.
  const failures: CookieTransportError[] = [];
  for (const index of injected.reverse()) {
    const old = previous[index];
    try {
      if (old) {
        const hostCookie = old.name.startsWith("__Host-");
        const restored = await browser.cookies.set({
          url,
          name: old.name,
          value: old.value,
          ...(!hostCookie && !old.hostOnly ? { domain: old.domain } : {}),
          path: hostCookie ? "/" : old.path,
          secure: old.secure,
          httpOnly: old.httpOnly,
          sameSite: old.sameSite,
          expirationDate: old.expirationDate,
          storeId: old.storeId,
        });
        if (!restored) throw new Error("Cookie restoration failed");
      } else {
        const name = entries[index]!.name;
        const removed = await browser.cookies.remove({ url, name });
        if (!removed && (await browser.cookies.get({ url, name })))
          throw new Error("Cookie removal failed");
      }
    } catch (error) {
      failures.push(
        new CookieTransportError("restoration", entries[index]!.name, error),
      );
    }
  }
  // Restoration failure takes precedence after every field has been attempted.
  if (failures.length) throw failures[0];
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}
