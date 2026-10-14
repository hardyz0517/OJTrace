import type { ProblemAsset, ProblemWarning } from "./domain";

interface CapturedImage {
  sourceUrl: string;
  dataUrl?: string;
  mimeType?: string;
}

/**
 * Attach already-fetched image bytes to the statement assets discovered during
 * extraction. The match key is the URL stored on the statement, never a
 * redirected fetch URL.
 */
export function mergeCapturedImages(
  assets: readonly ProblemAsset[],
  warnings: readonly ProblemWarning[],
  capturedAssets: readonly CapturedImage[] | undefined,
  capturedWarnings: readonly ProblemWarning[] | undefined,
): { assets: ProblemAsset[]; warnings: ProblemWarning[] } {
  const captured = new Map(
    (capturedAssets ?? []).map((asset) => [asset.sourceUrl, asset]),
  );
  const merged = assets.map((asset) => {
    const found = captured.get(asset.sourceUrl);
    if (!found) return asset;
    return {
      ...asset,
      ...(found.dataUrl ? { dataUrl: found.dataUrl } : {}),
      ...(found.mimeType ? { mimeType: found.mimeType } : {}),
    };
  });
  const embeddedUrls = merged
    .filter((asset) => asset.dataUrl)
    .map((asset) => asset.sourceUrl);
  const nextWarnings = [...warnings, ...(capturedWarnings ?? [])].filter(
    (warning) =>
      warning.code !== "image-unembedded" ||
      !embeddedUrls.some((url) => warning.message.endsWith(`：${url}`)),
  );
  return { assets: merged, warnings: nextWarnings };
}
