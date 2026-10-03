import { type FetchInput, type HttpResponse } from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { createHydroOJInstance } from "./instance";
import { isHydroOJLoginPage, parseHydroOJRecordPage } from "./parser";

export function originFor(account: { origin?: string }): string {
  return createHydroOJInstance(account.origin).origin;
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
  input: FetchInput,
  origin: string,
  cookie: string | undefined,
): Parameters<NonNullable<FetchInput["http"]["request"]>>[2] {
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
  input: FetchInput,
  kind: ConstructorParameters<typeof AdapterFailure>[0]["kind"],
  stage: ConstructorParameters<typeof AdapterFailure>[0]["stage"],
  messageKey: string,
  response?: HttpResponse,
): AdapterFailure {
  return new AdapterFailure({
    kind,
    source: "hydroj",
    stage,
    messageKey,
    retryable: response ? response.status >= 500 : false,
    userAction: kind === "auth_required" ? "open_site_login" : undefined,
    ...(response ? { httpStatus: response.status } : {}),
    requestId: input.requestId,
  });
}

export function assertRecordResponse(
  input: FetchInput,
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
  input: FetchInput,
  origin: string,
): Promise<{ uid?: string; username?: string }> {
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
      new URL("/login", origin).href,
      {
        method: "POST",
        body: new URLSearchParams({
          uname: username,
          password,
          rememberme: "on",
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
    throw AdapterFailure.fromTransport(error, "hydroj", input.requestId);
  }
  const identity = parseHydroUser(response.text);
  if (
    response.status < 200 ||
    response.status >= 300 ||
    isHydroOJLoginPage(response.text) ||
    !identity.username
  ) {
    throw new AdapterFailure({
      kind: "auth_required",
      source: "hydroj",
      stage: "identity",
      messageKey: "source.loginFailed",
      retryable: false,
      userAction: "edit_account",
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  return identity;
}

export async function requestPage(
  input: FetchInput,
  url: string,
  origin: string,
  cookie: string | undefined,
  format: "json" | "html" = "html",
): Promise<HttpResponse> {
  try {
    return await input.http.request("hydroj", url, {
      ...requestOptions(input, origin, cookie),
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        Accept: format === "json" ? "application/json" : "text/html",
      },
    });
  } catch (error) {
    throw AdapterFailure.fromTransport(error, "hydroj", input.requestId);
  }
}

export async function requestRecordPage(
  input: FetchInput,
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

const sessionQueues = new Map<string, Promise<unknown>>();

export function withInstanceSession<T>(
  origin: string,
  task: () => Promise<T>,
): Promise<T> {
  const operation = (sessionQueues.get(origin) ?? Promise.resolve())
    .catch(() => undefined)
    .then(task);
  sessionQueues.set(origin, operation);
  void operation
    .finally(() => {
      if (sessionQueues.get(origin) === operation) sessionQueues.delete(origin);
    })
    .catch(() => undefined);
  return operation;
}
