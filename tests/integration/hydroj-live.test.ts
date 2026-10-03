import { expect, it } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import type {
  HttpClient,
  HttpRequestOptions,
  HttpResponse,
} from "../../src/domain";

// Opt-in only. Credentials are supplied by the invoking environment, never fixtures.
const origin = process.env.OJTRACE_HYDRO_ORIGIN;
const username = process.env.OJTRACE_HYDRO_USERNAME;
const password = process.env.OJTRACE_HYDRO_PASSWORD;

it.skipIf(!origin || !username || !password)(
  "syncs real Hydro ordinary, contest, homework and branding data",
  async () => {
    const cookies = new Map<string, string>();
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
          if (new URL(url).origin !== new URL(origin!).origin)
            throw new Error("Unexpected origin");
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
        origin: origin!,
        authMode: "password" as const,
        enabled: true,
      },
      credentials: { username: username!, password: password! },
      http,
      signal: new AbortController().signal,
      requestId: "live",
      now: Date.now(),
      limit: 1000,
      since: 0,
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
    expect(fetched.records.some((record) => !record.activityId)).toBe(true);
    expect(
      fetched.records.some((record) => record.activityType === "contest"),
    ).toBe(true);
    expect(
      fetched.records.some((record) => record.activityType === "homework"),
    ).toBe(true);
    expect(
      fetched.records.every(
        (record) =>
          record.problemName && record.problemUrl && record.submissionUrl,
      ),
    ).toBe(true);
    expect(
      new Set(fetched.records.map((record) => record.submissionId)).size,
    ).toBe(fetched.records.length);
    const metadata = await hydroOJAdapter.fetchInstanceBranding!(input);
    expect(metadata.branding?.name).toBeTruthy();
    console.info(
      JSON.stringify({
        uid: authorized.providerAccountKey,
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
  60_000,
);
