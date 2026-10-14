import { describe, expect, it } from "vitest";
import {
  embeddableImageType,
  imageFileExtension,
} from "../../../src/problem/extract/image-type";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const html = new TextEncoder().encode("<html>not an image</html>");

describe("embeddable image types", () => {
  it("rejects a PNG declaration whose bytes are HTML", () => {
    expect(embeddableImageType("image/png", html)).toBeUndefined();
  });

  it("accepts a PNG declaration that matches the PNG signature", () => {
    expect(embeddableImageType("image/png", png)).toBe("image/png");
  });

  it("sniffs a PNG when the response omits an image type", () => {
    expect(embeddableImageType("application/octet-stream", png)).toBe(
      "image/png",
    );
  });

  it("trusts a declared SVG when the text sniffer does not see an svg tag", () => {
    expect(embeddableImageType("image/svg+xml", html)).toBe("image/svg+xml");
  });

  it("keeps file suffixes on the same four types", () => {
    expect(imageFileExtension("image/png")).toBe("png");
    expect(imageFileExtension("image/jpeg")).toBe("jpg");
    expect(imageFileExtension("image/gif")).toBe("gif");
    expect(imageFileExtension("image/svg+xml")).toBe("svg");
    expect(imageFileExtension("image/webp")).toBeUndefined();
    expect(
      imageFileExtension(embeddableImageType("image/png", png) ?? ""),
    ).toBe("png");
  });
});
