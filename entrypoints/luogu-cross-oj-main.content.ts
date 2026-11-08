import { installLuoguMainRecordRouteGuard } from "../src/oj-enhancer/features/cross-oj-submit/luogu-record-route-main";

export default defineContentScript({
  matches: ["https://www.luogu.com.cn/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installLuoguMainRecordRouteGuard(window);
  },
});
