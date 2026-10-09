import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "OJTrace（题迹）",
    description: "Local-first cross-OJ submission timeline",
    version: "0.1.2",
    permissions: ["storage", "tabs", "cookies"],
    host_permissions: ["https://qoj.ac/*"],
    optional_host_permissions: [
      "https://codeforces.com/*",
      "https://www.luogu.com.cn/*",
      "https://atcoder.jp/*",
      "https://kenkoooo.com/*",
      // Chrome only permits permissions.request() for patterns declared here.
      // HydroOJ still validates and uses the exact user-entered origin at
      // runtime; these optional patterns only make arbitrary instances
      // requestable.
      "https://*/*",
      "http://*/*",
    ],
    icons: {
      16: "icons/ojtrace-16.png",
      32: "icons/ojtrace-32.png",
      48: "icons/ojtrace-48.png",
      128: "icons/ojtrace-128.png",
    },
    action: {
      default_title: "Open OJTrace",
      default_icon: {
        16: "icons/ojtrace-16.png",
        32: "icons/ojtrace-32.png",
        48: "icons/ojtrace-48.png",
      },
    },
  },
});
