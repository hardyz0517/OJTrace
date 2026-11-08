import { installCloudflareChallengeXhrTimeoutPatch } from "../src/oj-enhancer/features/cloudflare-challenge/xhr-timeout";

export default defineContentScript({
  // Cloudflare runs the verification client inside this dedicated iframe.
  // MAIN world is required so the hook sees the page's XMLHttpRequest object.
  matches: ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/*"],
  allFrames: true,
  runAt: "document_start",
  world: "MAIN",
  main() {
    installCloudflareChallengeXhrTimeoutPatch({
      location,
      XMLHttpRequest,
    });
  },
});
