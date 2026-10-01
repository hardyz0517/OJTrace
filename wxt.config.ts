import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "OJTrace（题迹）",
    description: "Local-first cross-OJ submission timeline",
    version: "0.1.0",
    permissions: [
      "storage",
      "tabs",
      "scripting",
      "cookies",
      "https://qoj.ac/*",
    ],
    optional_host_permissions: [
      "https://codeforces.com/*",
      "https://www.luogu.com.cn/*",
      "https://qoj.ac/*",
      "https://atcoder.jp/*",
      "https://kenkoooo.com/*",
      // Chrome only permits permissions.request() for patterns declared here.
      // HydroOJ still validates and uses the exact user-entered origin at
      // runtime; these optional patterns only make arbitrary instances
      // requestable.
      "https://*/*",
      "http://*/*",
    ],
    action: {
      default_title: "Open OJTrace",
    },
  },
});
