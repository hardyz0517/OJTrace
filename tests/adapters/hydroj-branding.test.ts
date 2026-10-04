import { describe, expect, it } from "vitest";
import {
  fetchHydroBranding,
  parseHydroBrandingHtml,
} from "../../src/adapters/hydroj/branding";

describe("Hydro instance branding", () => {
  it("reads the selected domain home and tags its icon cache with that domain", async () => {
    const urls: string[] = [];
    const branding = await fetchHydroBranding(
      {
        async request(_source, url) {
          urls.push(url);
          return {
            status: 200,
            url,
            headers: new Headers(),
            text:
              urls.length === 1 ? '<link rel="icon" href="student.png">' : "",
            contentType: urls.length === 1 ? "text/html" : "image/png",
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
          };
        },
      },
      {
        origin: "https://oj.example.org",
        domainId: "student",
        source: "hydroj",
        signal: new AbortController().signal,
      },
    );
    expect(urls).toEqual([
      "https://oj.example.org/d/student/",
      "https://oj.example.org/d/student/student.png",
    ]);
    expect(branding).toMatchObject({
      domainId: "student",
      iconDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    });
  });

  it("does not cache a root page returned for a selected domain", async () => {
    let calls = 0;
    await expect(
      fetchHydroBranding(
        {
          async request() {
            calls += 1;
            return {
              status: 200,
              url: "https://oj.example.org/",
              text: '<link rel="icon" href="/icon.png">',
              contentType: "text/html",
              headers: new Headers(),
            };
          },
        },
        {
          origin: "https://oj.example.org",
          domainId: "student",
          source: "hydroj",
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("ignores site names and prioritizes 32px same-origin icons regardless of attribute order", () => {
    const parsed = parseHydroBrandingHtml(
      `<meta name="application-name" content="Fallback"><meta content="A &amp; B" property="og:site_name"><link sizes="96x96" rel="icon" href="/96.png"><link href="icon.png" SIZES="32x32" REL="ICON"><link rel="icon" href="https://cdn.other.org/i.png"><link rel="icon" href="https://user:secret@oj.example.org/credential.png">`,
      "https://oj.example.org/login/",
    );
    expect(parsed).not.toHaveProperty("name");
    expect(parsed.iconUrls[0]).toBe("https://oj.example.org/login/icon.png");
    expect(
      parsed.iconUrls.every((url) => {
        const parsedUrl = new URL(url);
        return (
          parsedUrl.origin === "https://oj.example.org" &&
          !parsedUrl.username &&
          !parsedUrl.password
        );
      }),
    ).toBe(true);
  });

  it("rejects SVG and bad signatures, caches only bounded raster bytes", async () => {
    const urls: string[] = [];
    const branding = await fetchHydroBranding(
      {
        async request(_source, url) {
          urls.push(url);
          const root = urls.length === 1;
          return {
            status: 200,
            url,
            text: root
              ? '<meta property="og:site_name" content="School"><link rel="icon" href="/bad.png"><link rel="icon" href="/ok.png">'
              : "",
            bytes: root
              ? undefined
              : url.endsWith("bad.png")
                ? new Uint8Array([1, 2])
                : new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            contentType: root ? "text/html" : "image/png",
            headers: new Headers(),
          };
        },
      },
      {
        origin: "https://oj.example.org",
        source: "hydroj",
        signal: new AbortController().signal,
        now: 10,
      },
    );
    expect(branding).toMatchObject({
      name: "HydroOJ",
      iconDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      fetchedAt: 10,
      iconFetchedAt: 10,
    });
    expect(urls).toHaveLength(3);
  });

  it("uses HydroOJ when all icons are unavailable instead of the page name or hostname", async () => {
    const branding = await fetchHydroBranding(
      {
        async request(_source, url) {
          return {
            status: url.endsWith("/") ? 200 : 404,
            url,
            text: '<meta property="og:site_name" content="School">',
            contentType: "image/svg+xml",
            bytes: new Uint8Array([1]),
            headers: new Headers(),
          };
        },
      },
      {
        origin: "https://oj.example.org",
        source: "hydroj",
        signal: new AbortController().signal,
        now: 10,
      },
    );
    expect(branding.name).toBe("HydroOJ");
    expect(branding.iconDataUrl).toBeUndefined();
  });
});
