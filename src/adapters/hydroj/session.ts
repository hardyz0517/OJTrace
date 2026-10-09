import { createKeyedSerialQueue } from "../../platform/async/serial-queue";
import { type AdapterContext, type HttpResponse } from "../../domain";
import { AdapterFailure, createAdapterFailure } from "../../domain/errors";
import { createHydroOJInstance } from "./instance";
import {
  hydroScopedUrl,
  isHydroScopeUrl,
  type HydroScope,
} from "../../domain/hydro-scope";
import { isHydroOJLoginPage, parseHydroOJRecordPage } from "./parser";

export function scopeFor(account: { origin?: string; domainId?: string }) {
  return createHydroOJInstance(account.origin, account.domainId);
}

export function originFor(account: {
  origin?: string;
  domainId?: string;
}): string {
  return scopeFor(account).origin;
}

export class HydroScopeMismatchError extends Error {
  constructor() {
    super("Hydro response left the requested domain");
    this.name = "HydroScopeMismatchError";
  }
}

export function assertHydroScopeResponse(
  scope: HydroScope,
  response: HttpResponse,
): void {
  if (!isHydroScopeUrl(scope, response.url))
    throw new HydroScopeMismatchError();
  const context = response.text.match(
    /window\.UiContext\s*=\s*'([\s\S]*?)';/i,
  )?.[1];
  if (scope.domainId !== undefined && context) {
    try {
      const actual = JSON.parse(context).domainId;
      if (actual !== scope.domainId) throw new HydroScopeMismatchError();
    } catch {
      throw new HydroScopeMismatchError();
    }
  }
}

export function parseHydroUser(text: string): {
  uid?: string;
  username?: string;
} {
  const raw = text.match(/window\.UserContext\s*=\s*'([\s\S]*?)';/i)?.[1];
  if (!raw) return {};
  try {
    const user = JSON.parse(raw) as { _id?: number; uname?: string };
    return {
      uid:
        Number.isSafeInteger(user._id) && Number(user._id) > 0
          ? String(user._id)
          : undefined,
      username: user.uname && user.uname !== "Guest" ? user.uname : undefined,
    };
  } catch {
    return {};
  }
}

function requestOptions(
  input: AdapterContext,
  origin: string,
  cookie: string | undefined,
): Parameters<NonNullable<AdapterContext["http"]["request"]>>[2] {
  return {
    credentials:
      input.account.authMode === "manual-cookie" ? "omit" : "include",
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
    signal: input.signal,
    hydroOrigin: origin,
    followRedirects: true,
  };
}

export function failure(
  input: AdapterContext,
  kind: ConstructorParameters<typeof AdapterFailure>[0]["kind"],
  stage: ConstructorParameters<typeof AdapterFailure>[0]["stage"],
  messageKey: string,
  response?: HttpResponse,
): AdapterFailure {
  return createAdapterFailure("hydroj", input.requestId, {
    kind,
    stage,
    messageKey,
    retryable:
      kind === "rate_limited" || (response ? response.status >= 500 : false),
    userAction:
      kind === "auth_required"
        ? "open_site_login"
        : kind === "rate_limited"
          ? "retry_later"
          : undefined,
    ...(response ? { httpStatus: response.status } : {}),
  });
}

export function assertRecordResponse(
  input: AdapterContext,
  response: HttpResponse,
): void {
  if (response.status === 401 || isHydroOJLoginPage(response.text))
    throw failure(
      input,
      "auth_required",
      "request",
      "source.authRequired",
      response,
    );
  if (response.status === 429)
    throw failure(
      input,
      "rate_limited",
      "request",
      "source.rateLimited",
      response,
    );
  if (response.status < 200 || response.status >= 300)
    throw failure(
      input,
      response.status === 403 ? "blocked" : "network",
      "request",
      "source.httpError",
      response,
    );
}

export async function loginHydroOJ(
  input: AdapterContext,
  origin: string,
): Promise<{ uid?: string; username?: string }> {
  input.signal.throwIfAborted();
  const username = input.credentials?.username?.trim();
  const password = input.credentials?.password ?? "";
  if (!username || !password) {
    throw failure(
      input,
      "invalid_response",
      "identity",
      "account.loginCredentialsRequired",
    );
  }
  let response: HttpResponse;
  try {
    response = await input.http.request(
      "hydroj",
      hydroScopedUrl(scopeFor(input.account), "/login"),
      {
        method: "POST",
        body: new URLSearchParams({
          uname: username,
          password,
          rememberme: "on",
          redirect: hydroScopedUrl(scopeFor(input.account)),
          tfa: "",
          authnChallenge: "",
          login_submit: "登录",
        }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/html",
        },
        credentials: "include",
        followRedirects: true,
        signal: input.signal,
        hydroOrigin: origin,
      },
    );
  } catch (error) {
    if (input.signal.aborted) throw error;
    if (error instanceof AdapterFailure) throw error;
    throw AdapterFailure.fromTransport(error, "hydroj", input.requestId);
  }
  input.signal.throwIfAborted();
  if (response.status === 429)
    throw failure(
      input,
      "rate_limited",
      "request",
      "source.rateLimited",
      response,
    );
  const identity = parseHydroUser(response.text);
  if (
    response.status < 200 ||
    response.status >= 300 ||
    isHydroOJLoginPage(response.text) ||
    !identity.username
  ) {
    throw createAdapterFailure("hydroj", input.requestId, {
      kind: "auth_required",
      stage: "identity",
      messageKey: "source.loginFailed",
      retryable: false,
      userAction: "edit_account",
      httpStatus: response.status,
    });
  }
  try {
    assertHydroScopeResponse(scopeFor(input.account), response);
  } catch {
    throw failure(
      input,
      "invalid_response",
      "identity",
      "source.scopeMismatch",
      response,
    );
  }
  return identity;
}

export async function requestPage(
  input: AdapterContext,
  url: string,
  origin: string,
  cookie: string | undefined,
  format: "json" | "html" = "html",
): Promise<HttpResponse> {
  input.signal.throwIfAborted();
  try {
    const response = await input.http.request("hydroj", url, {
      ...requestOptions(input, origin, cookie),
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        Accept: format === "json" ? "application/json" : "text/html",
      },
    });
    input.signal.throwIfAborted();
    if (
      response.status >= 200 &&
      response.status < 300 &&
      !isHydroOJLoginPage(response.text)
    ) {
      try {
        assertHydroScopeResponse(scopeFor(input.account), response);
      } catch {
        throw failure(
          input,
          "invalid_response",
          "request",
          "source.scopeMismatch",
          response,
        );
      }
    }
    return response;
  } catch (error) {
    if (input.signal.aborted) throw error;
    if (error instanceof AdapterFailure) throw error;
    throw AdapterFailure.fromTransport(error, "hydroj", input.requestId);
  }
}

export async function requestRecordPage(
  input: AdapterContext,
  url: string,
  origin: string,
  cookie?: string,
): Promise<HttpResponse> {
  const response = await requestPage(input, url, origin, cookie, "json");
  if (
    response.status < 200 ||
    response.status >= 300 ||
    isHydroOJLoginPage(response.text)
  )
    return response;
  try {
    parseHydroOJRecordPage(response.text);
    return response;
  } catch {
    return requestPage(input, url, origin, cookie, "html");
  }
}

const runInstanceSession = createKeyedSerialQueue();

export function withInstanceSession<T>(
  origin: string,
  task: () => Promise<T>,
): Promise<T> {
  // Lock order: instance session -> pagination -> browser Cookie scope -> HTTP.
  // Keep the session until the task (including Cookie restoration) truly settles.
  return runInstanceSession(origin, task);
}
