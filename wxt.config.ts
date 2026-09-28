import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "OJTrace（题迹）",
    description: "Local-first cross-OJ submission timeline",
    version: "0.1.0",
    permissions: ["storage", "tabs"],
    optional_host_permissions: [
      "https://codeforces.com/*",
      "https://www.luogu.com.cn/*",
      "https://qoj.ac/*",
      "https://loj.ac/*",
    ],
    action: {
      default_title: "Open OJTrace",
    },
  },
});
