import { describe, expect, it } from "vitest";
import {
  cookieHeaderFromCredentials,
  normalizeCookieHeader,
} from "../../src/domain";

describe("credential cookie helpers", () => {
  it("normalizes a full Cookie header and drops attributes", () => {
    expect(
      normalizeCookieHeader("__client_id=client; _uid=99; Path=/; Secure"),
    ).toBe("__client_id=client; _uid=99");
  });

  it("composes named fields for sites with multiple required cookies", () => {
    expect(
      cookieHeaderFromCredentials({ __client_id: "client", _uid: "99" }, [
        "__client_id",
        "_uid",
      ]),
    ).toBe("__client_id=client; _uid=99");
  });

  it("supports a full Cookie field when a site exposes one", () => {
    expect(
      cookieHeaderFromCredentials({ cookie: "__client_id=client; _uid=99" }, [
        "cookie",
        "__client_id",
        "_uid",
      ]),
    ).toBe("__client_id=client; _uid=99");
  });

  it("does not enable undeclared full-cookie input for structured sites", () => {
    expect(
      cookieHeaderFromCredentials({ cookie: "__client_id=client; _uid=99" }, [
        "__client_id",
        "_uid",
      ]),
    ).toBeUndefined();
  });
});
