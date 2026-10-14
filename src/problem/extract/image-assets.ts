import {
  attr,
  findAll,
  type HtmlRootNode,
  type HtmlElementNode,
} from "./html-document";
import type { ProblemAsset } from "../domain";

export function resolveResourceUrl(
  value: string | undefined,
  baseUrl: string,
): string | undefined {
  const raw = value?.trim();
  if (!raw || /^(?:data|blob|javascript|vbscript):/i.test(raw))
    return undefined;
  try {
    const url = new URL(raw, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function collectImageAssets(
  root: HtmlRootNode | HtmlElementNode,
  baseUrl: string,
): ProblemAsset[] {
  const assets: ProblemAsset[] = [];
  for (const node of findAll(root, (item) => item.tagName === "img")) {
    const sourceUrl = resolveResourceUrl(
      attr(node, "src") ?? attr(node, "data-src"),
      baseUrl,
    );
    if (!sourceUrl) continue;
    const width = parseDimension(attr(node, "width"));
    const height = parseDimension(attr(node, "height"));
    assets.push({
      sourceUrl,
      ...(attr(node, "alt") ? { alt: attr(node, "alt") } : {}),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    });
  }
  return uniqueAssets(assets);
}

function parseDimension(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function uniqueAssets(assets: readonly ProblemAsset[]): ProblemAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.sourceUrl)) return false;
    seen.add(asset.sourceUrl);
    return true;
  });
}
