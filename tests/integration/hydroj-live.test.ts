import { expect, it } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import { createHydroOJInstance } from "../../src/adapters/hydroj/instance";
import { isHydroScopeUrl } from "../../src/domain/hydro-scope";
import { createPaginationRuntime } from "../../src/platform/network/pagination-throttle";
import { isActivityOutsideWindow } from "../../src/domain/activity-schedule";
import type {
  HttpClient,
  HttpRequestOptions,
  HttpResponse,
} from "../../src/domain";

// Opt-in only. Credentials are supplied by the invoking environment, never fixtures.
const address = process.env.OJTRACE_HYDRO_ORIGIN;
const username = process.env.OJTRACE_HYDRO_USERNAME;
const password = process.env.OJTRACE_HYDRO_PASSWORD;

it.skipIf(!address || !username || !password)(
  "syncs real Hydro time-windowed lists and branding data",
  async () => {
    const scope = createHydroOJInstance(address!);
    const cookies = new Map<string, string>();
    let loginCount = 0;
    const http: HttpClient = {
      async request(
        _source,
        initialUrl,
        options: HttpRequestOptions = {},
      ): Promise<HttpResponse> {
        let url = initialUrl;
        let method = options.method ?? "GET";
        let body = options.body;
        for (let redirect = 0; redirect < 8; redirect += 1) {
          if (new URL(url).origin !== scope.origin)
            throw new Error("Unexpected origin");
          if (method === "POST" && new URL(url).pathname.endsWith("/login"))
            loginCount += 1;
          const response = await fetch(url, {
            method,
            body,
            redirect: "manual",
            signal: options.signal,
            headers: {
              ...options.headers,
              ...(cookies.size
                ? {
                    Cookie: [...cookies]
                      .map(([name, value]) => `${name}=${value}`)
                      .join("; "),
                  }
                : {}),
            },
          });
          for (const header of response.headers.getSetCookie()) {
            const pair = header.split(";")[0]!;
            const index = pair.indexOf("=");
            if (index > 0)
              cookies.set(pair.slice(0, index), pair.slice(index + 1));
          }
          if (
            response.status >= 300 &&
            response.status < 400 &&
            response.headers.get("location")
          ) {
            url = new URL(response.headers.get("location")!, url).href;
            method = "GET";
            body = undefined;
            continue;
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          return {
            url,
            status: response.status,
            contentType: response.headers.get("content-type") ?? "",
            headers: response.headers,
            text:
              options.responseType === "bytes"
                ? ""
                : new TextDecoder().decode(bytes),
            bytes,
          };
        }
        throw new Error("Too many redirects");
      },
    };
    const input = {
      account: {
        accountId: "live",
        source: "hydroj" as const,
        origin: scope.origin,
        domainId: scope.domainId,
        authMode: "password" as const,
        enabled: true,
      },
      credentials: { username: username!, password: password! },
      http,
      signal: new AbortController().signal,
      requestId: "live",
      now: Date.now(),
      limit: 1000,
      since: Date.now() - 35 * 24 * 60 * 60 * 1000,
      until: Date.now(),
      pagination: createPaginationRuntime(),
    };
    const authorized = await hydroOJAdapter.authorize(input);
    expect(authorized.providerAccountKey).toMatch(/^\d+$/);
    // Simulate expiry and exercise the adapter's automatic password login.
    cookies.clear();
    const fetched = await hydroOJAdapter.fetchRecent({
      ...input,
      account: {
        ...input.account,
        providerAccountKey: authorized.providerAccountKey,
      },
    });
    expect(fetched.account.providerAccountKey).toBe(
      authorized.providerAccountKey,
    );
    expect(loginCount).toBe(2);
    if (process.env.OJTRACE_HYDRO_REQUIRE_RECORDS === "1")
      expect(fetched.records.length).toBeGreaterThan(0);
    for (const record of fetched.records) {
      expect(record.domainId).toBe(scope.domainId);
      for (const url of [
        record.problemUrl,
        record.submissionUrl,
        record.fallbackListUrl,
        record.activityUrl,
      ]) {
        if (url) expect(isHydroScopeUrl(scope, url)).toBe(true);
      }
    }
    expect(
      fetched.records.every(
        (record) =>
          record.submittedAt >= input.since &&
          record.submittedAt <= input.until,
      ),
    ).toBe(true);
    expect(fetched.coverage.window).toEqual({
      since: input.since,
      until: input.until,
    });
    expect(
      fetched.records.every(
        (record) =>
          record.problemName && record.problemUrl && record.submissionUrl,
      ),
    ).toBe(true);
    expect(
      new Set(fetched.records.map((record) => record.submissionId)).size,
    ).toBe(fetched.records.length);
    if (process.env.OJTRACE_HYDRO_TEST_ACTIVITY_CACHE === "1") {
      const schedules = fetched.activitySchedules ?? [];
      const expectedSkips = schedules.filter((item) =>
        isActivityOutsideWindow(item, input, input.now),
      ).length;
      expect(expectedSkips).toBeGreaterThan(0);
      const cached = await hydroOJAdapter.fetchRecent({
        ...input,
        account: {
          ...input.account,
          providerAccountKey: authorized.providerAccountKey,
        },
        activitySchedules: schedules,
      });
      const skipped = cached.diagnostics.filter(
        (item) => item.context?.status === "cached-outside-window",
      ).length;
      expect(skipped).toBe(expectedSkips);
      expect(cached.coverage.pagesFetched).toBeLessThan(
        fetched.coverage.pagesFetched,
      );
      console.info(
        JSON.stringify({
          activityCache: {
            initialPages: fetched.coverage.pagesFetched,
            cachedPages: cached.coverage.pagesFetched,
            skipped,
            observations: schedules.length,
          },
        }),
      );
    }
    const metadata = await hydroOJAdapter.fetchInstanceBranding!(input);
    expect(metadata.branding?.name).toBeTruthy();
    console.info(
      JSON.stringify({
        uid: authorized.providerAccountKey,
        domainId: scope.domainId ?? "default",
        logins: loginCount,
        outcome: fetched.coverage.outcome,
        pagesFetched: fetched.coverage.pagesFetched,
        records: fetched.records.length,
        ordinary: fetched.records.filter((record) => !record.activityId).length,
        contest: fetched.records.filter(
          (record) => record.activityType === "contest",
        ).length,
        homework: fetched.records.filter(
          (record) => record.activityType === "homework",
        ).length,
        activityCount: fetched.diagnostics.filter(
          (item) => item.context?.activityId,
        ).length,
        warnings: fetched.diagnostics
          .filter((item) => item.severity !== "info")
          .map((item) => item.code),
        name: metadata.branding?.name,
        icon: !!metadata.branding?.iconDataUrl,
      }),
    );
  },
  240_000,
);
