import type { SourceId } from "../../domain";
import {
  isAllowedNavigation,
  isAllowedOriginNavigation,
} from "../permissions/hosts";

export async function openSubmissionNavigation(
  source: SourceId,
  url: string | undefined,
  origin?: string,
): Promise<boolean> {
  if (
    !url ||
    !(origin
      ? isAllowedOriginNavigation(source, origin, url)
      : isAllowedNavigation(source, url))
  )
    return false;
  await browser.tabs.create({ url });
  return true;
}
