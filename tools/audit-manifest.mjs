import { readFile } from "node:fs/promises";

const manifestPath = new URL(
  "../.output/chrome-mv3/manifest.json",
  import.meta.url,
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const permissions = new Set(manifest.permissions ?? []);
const hostPermissions = new Set(manifest.host_permissions ?? []);
const optionalHosts = new Set(manifest.optional_host_permissions ?? []);
const forbidden = ["webRequest", "<all_urls>"];
const unexpected = forbidden.filter(
  (permission) => permissions.has(permission) || optionalHosts.has(permission),
);
const expectedHosts = [
  "https://codeforces.com/*",
  "https://www.luogu.com.cn/*",
  "https://atcoder.jp/*",
  "https://kenkoooo.com/*",
  "https://*/*",
  "http://*/*",
];

if (!hostPermissions.has("https://qoj.ac/*")) {
  throw new Error("QOJ must remain a fixed host permission");
}

if (unexpected.length > 0) {
  throw new Error(`Forbidden permissions found: ${unexpected.join(", ")}`);
}
if (permissions.has("scripting")) {
  throw new Error("The extension must not depend on page-context scripting");
}
if (
  optionalHosts.size !== expectedHosts.length ||
  expectedHosts.some((host) => !optionalHosts.has(host))
) {
  throw new Error(
    `Unexpected optional host permissions: ${[...optionalHosts].join(", ")}`,
  );
}
const luoguContentScript = (manifest.content_scripts ?? []).find((item) =>
  (item.matches ?? []).includes("https://www.luogu.com.cn/*"),
);
if (luoguContentScript) {
  throw new Error(
    "Luogu page-session content script must not be bundled; sync is service-worker-only",
  );
}
console.log("Manifest permission audit passed.");
