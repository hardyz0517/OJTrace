import {
  isPdfWorkerRequest,
  PDF_WORKER_ALIVE,
} from "../../src/application/problem-export/pdf-worker-messages";
import { OffscreenPdfRenderer } from "./renderer";

const renderer = new OffscreenPdfRenderer();
window.addEventListener("pagehide", () => renderer.dispose(), { once: true });
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (
    sender.id !== browser.runtime.id ||
    sender.tab ||
    !isPdfWorkerRequest(raw)
  )
    return undefined;
  if (raw.type === "release") {
    renderer.release(raw.id);
    return Promise.resolve({ ok: true });
  }
  return renderer.render(raw.id, raw.document);
});

// Offscreen runtime messages keep MV3 alive during capture and local WASM work,
// including after the user dismisses the popup. The document is closed on exit.
window.setInterval(() => {
  void browser.runtime.sendMessage({ type: PDF_WORKER_ALIVE }).catch(() => {});
}, 20_000);
