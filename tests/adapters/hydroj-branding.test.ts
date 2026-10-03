import { describe, expect, it } from "vitest";
import {
  fetchHydroBranding,
  parseHydroBrandingHtml,
} from "../../src/adapters/hydroj/branding";

describe("Hydro instance branding", () => {
  it("prioritizes og name and 32px same-origin icons regardless of attribute order", () => {
    const parsed = parseHydroBrandingHtml(
      `<meta name="application-name" content="Fallback"><meta content="A &amp; B" property="og:site_name"><link sizes="96x96" rel="icon" href="/96.png"><link href="icon.png" SIZES="32x32" REL="ICON"><link rel="icon" href="https://cdn.other.org/i.png"><link rel="icon" href="https://user:secret@oj.example.org/credential.png">`,
      "https://oj.example.org/login/",
    );
    expect(parsed.name).toBe("A & B");
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
      name: "School",
      iconDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      fetchedAt: 10,
      iconFetchedAt: 10,
    });
    expect(urls).toHaveLength(3);
  });

  it("preserves a usable name when all icons are unavailable", async () => {
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
    expect(branding.name).toBe("School");
    expect(branding.iconDataUrl).toBeUndefined();
  });
});
