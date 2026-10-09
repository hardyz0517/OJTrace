import { immediatePagination } from "../helpers/fetch-input";
import { httpResponse as response } from "../helpers/http-response";
import { describe, expect, it } from "vitest";
import { hydroOJAdapter } from "../../src/adapters/hydroj";
import type { FetchInput, HttpClient } from "../../src/domain";

const origin = "https://session.example.org";
const home = (uid: string) =>
  `<script>window.UserContext = '{"_id":${uid},"uname":"user${uid}"}';</script>`;

function input(http: HttpClient, uid: string): FetchInput {
  return {
    account: {
      source: "hydroj",
      accountId: `a${uid}`,
      origin,
      providerAccountKey: uid,
      enabled: true,
      authMode: "password",
    },
    credentials: { username: `user${uid}`, password: "fake-test-password" },
    http,
    signal: new AbortController().signal,
    requestId: "r",
    now: 1,
    limit: 100,
    since: 0,
    until: 1,
    pagination: immediatePagination(),
  };
}
describe("Hydro session ownership", () => {
  it("serializes two password accounts on one instance and verifies both identities", async () => {
    let active: string | undefined;
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((done) => {
      release = done;
    });
    const firstStarted = new Promise<void>((done) => {
      started = done;
    });
    const logins: string[] = [];
    const queries: string[] = [];
    const http: HttpClient = {
      async request(_source, url, options) {
        const parsed = new URL(url);
        if (parsed.pathname === "/login") {
          active = new URLSearchParams(options?.body)
            .get("uname")!
            .replace("user", "");
          logins.push(active);
          return response(url, home(active));
        }
        if (parsed.pathname === "/")
          return response(
            url,
            active ? home(active) : '<html data-page="user_login"></html>',
          );
        if (parsed.pathname.startsWith("/user/"))
          return response(url, '{"tdocs":[]}');
        const uid = parsed.searchParams.get("uidOrName")!;
        queries.push(uid);
        expect(active).toBe(uid);
        if (uid === "42") {
          started();
          await blocked;
        }
        return response(url, '{"page":1,"rdocs":[]}');
      },
    };
    const first = hydroOJAdapter.fetchRecent(input(http, "42"));
    await firstStarted;
    const second = hydroOJAdapter.fetchRecent(input(http, "99"));
    await Promise.resolve();
    expect(logins).toEqual(["42"]);
    release();
    const results = await Promise.all([first, second]);
    expect(logins).toEqual(["42", "99"]);
    expect(queries).toEqual(["42", "99"]);
    expect(results.map((item) => item.account.providerAccountKey)).toEqual([
      "42",
      "99",
    ]);
  });
  it("rejects a browser session switched to another UID before fetching records", async () => {
    const requests: string[] = [];
    const http: HttpClient = {
      async request(_source, url) {
        requests.push(url);
        return response(url, home("99"));
      },
    };
    const request = input(http, "42");
    request.account.authMode = "browser-session";
    await expect(hydroOJAdapter.fetchRecent(request)).rejects.toMatchObject({
      error: { messageKey: "account.identityChanged" },
    });
    expect(requests).toEqual([`${origin}/`]);
  });
});
