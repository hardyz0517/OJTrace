import { describe, expect, it } from "vitest";
import { mergeCapturedImages } from "../../src/problem/merge-images";

describe("mergeCapturedImages", () => {
  it("clears an unembedded warning only when the message ends with that URL", () => {
    const shortUrl = "https://x/a";
    const longUrl = "https://x/a.png";
    const merged = mergeCapturedImages(
      [{ sourceUrl: shortUrl }, { sourceUrl: longUrl }],
      [
        {
          code: "image-unembedded",
          message: `图片无法嵌入 PDF，已保留原图链接：${shortUrl}`,
        },
        {
          code: "image-unembedded",
          message: `图片无法嵌入 PDF，已保留原图链接：${longUrl}`,
        },
        {
          code: "image-time-limit",
          message: "题面图片采集超时，未完成的图片已保留原图链接。",
        },
        {
          code: "image-count-limit",
          message: "超出 12 张图片采集上限的题面图片未嵌入 PDF。",
        },
      ],
      [{ sourceUrl: shortUrl, dataUrl: "data:image/png;base64,AA" }],
      [],
    );

    expect(merged.assets[0]?.dataUrl).toBe("data:image/png;base64,AA");
    expect(merged.assets[1]?.dataUrl).toBeUndefined();
    expect(merged.warnings.map((warning) => warning.message)).toEqual([
      `图片无法嵌入 PDF，已保留原图链接：${longUrl}`,
      "题面图片采集超时，未完成的图片已保留原图链接。",
      "超出 12 张图片采集上限的题面图片未嵌入 PDF。",
    ]);
  });
});
