import type { SourceId } from "../../domain";
import { isAllowedNavigation } from "../permissions/hosts";

export async function openSubmissionNavigation(
  source: SourceId,
  url: string | undefined,
): Promise<boolean> {
  if (!url || !isAllowedNavigation(source, url)) return false;
  await browser.tabs.create({ url });
  return true;
}
