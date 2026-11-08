const MASK_IDS = {
  atcoder: "ojtrace-atcoder-submit-mask",
  codeforces: "ojtrace-codeforces-submit-mask",
} as const;
const CHALLENGE_SELECTORS =
  ".cf-challenge, .cf-turnstile, iframe[src*='challenges.cloudflare.com'], [data-callback*='turnstile']";

let challengeObserver: MutationObserver | undefined;
const originalStyles = new Map<HTMLElement, string | null>();
let maskedRoot: HTMLElement | undefined;
let originalRootVisibility: { value: string; priority: string } | undefined;
let activeMaskId: (typeof MASK_IDS)[keyof typeof MASK_IDS] = MASK_IDS.atcoder;

function challengeSlot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `#${activeMaskId} [data-role="challenge-slot"]`,
  );
}

function setChallengeStyles(
  challenge: HTMLElement,
  styles: Record<string, string>,
): void {
  for (const [property, value] of Object.entries(styles)) {
    const cssProperty = property.replace(
      /[A-Z]/g,
      (letter) => `-${letter.toLowerCase()}`,
    );
    challenge.style.setProperty(cssProperty, value, "important");
  }
}

function installPageCoverStyle(): void {
  const root = document.documentElement;
  if (!root || maskedRoot) return;
  originalRootVisibility = {
    value: root.style.getPropertyValue("visibility"),
    priority: root.style.getPropertyPriority("visibility"),
  };
  root.style.setProperty("visibility", "hidden", "important");
  maskedRoot = root;
}

function positionChallenge(): void {
  const slot = challengeSlot();
  const challenge = document.querySelector<HTMLElement>(CHALLENGE_SELECTORS);
  if (!slot || !challenge) return;
  if (!originalStyles.has(challenge))
    originalStyles.set(challenge, challenge.getAttribute("style"));
  const rect = slot.getBoundingClientRect();
  setChallengeStyles(challenge, {
    position: "fixed",
    top: `${Math.round(rect.top)}px`,
    left: `${Math.round(rect.left)}px`,
    width: `${Math.round(rect.width)}px`,
    height: `${Math.round(rect.height)}px`,
    margin: "0",
    padding: "0",
    zIndex: "2147483647",
    visibility: "visible",
    pointerEvents: "auto",
  });
  const placeholder = document.querySelector<HTMLElement>(
    `#${activeMaskId} [data-role="challenge-placeholder"]`,
  );
  if (placeholder) placeholder.hidden = true;
}

export function showCrossOjSubmitMask(
  oj: keyof typeof MASK_IDS,
  message: string,
): void {
  activeMaskId = MASK_IDS[oj];
  installPageCoverStyle();
  const current = document.getElementById(activeMaskId);
  if (current) {
    const status = current.querySelector<HTMLElement>("[data-role='status']");
    if (status) status.textContent = message;
    positionChallenge();
    return;
  }

  const mask = document.createElement("div");
  mask.id = activeMaskId;
  mask.setAttribute("role", "status");
  mask.setAttribute("aria-live", "polite");
  Object.assign(mask.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    display: "grid",
    placeItems: "center",
    padding: "20px",
    boxSizing: "border-box",
    background: "rgba(246, 248, 251, 0.97)",
    color: "#263449",
    font: "14px/1.5 system-ui, sans-serif",
    pointerEvents: "auto",
    visibility: "visible",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "min(440px, calc(100vw - 40px))",
    padding: "28px 30px",
    border: "1px solid #dce3ec",
    borderRadius: "12px",
    background: "#fff",
    boxShadow: "0 12px 40px rgba(28, 49, 78, 0.14)",
    textAlign: "center",
    boxSizing: "border-box",
  });

  const brand = document.createElement("div");
  brand.textContent = `OJTrace · ${oj === "atcoder" ? "AtCoder" : "Codeforces"}`;
  Object.assign(brand.style, {
    marginBottom: "10px",
    color: "#2674c8",
    fontSize: "13px",
    fontWeight: "700",
    letterSpacing: "0.03em",
  });

  const heading = document.createElement("div");
  heading.textContent = "正在为你提交代码";
  Object.assign(heading.style, {
    color: "#17283d",
    fontSize: "20px",
    fontWeight: "700",
  });

  const status = document.createElement("div");
  status.dataset.role = "status";
  status.textContent = message;
  Object.assign(status.style, {
    marginTop: "8px",
    color: "#627187",
  });

  const slot = document.createElement("div");
  slot.dataset.role = "challenge-slot";
  Object.assign(slot.style, {
    position: "relative",
    width: "300px",
    height: "65px",
    maxWidth: "100%",
    margin: "20px auto 0",
  });

  const placeholder = document.createElement("div");
  placeholder.dataset.role = "challenge-placeholder";
  Object.assign(placeholder.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "7px",
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
  });
  const svgNamespace = "http://www.w3.org/2000/svg";
  const spinner = document.createElementNS(svgNamespace, "svg");
  spinner.setAttribute("aria-hidden", "true");
  spinner.setAttribute("viewBox", "0 0 24 24");
  spinner.setAttribute("width", "22");
  spinner.setAttribute("height", "22");
  Object.assign(spinner.style, {
    display: "block",
  });
  const spinnerCircle = document.createElementNS(svgNamespace, "circle");
  spinnerCircle.setAttribute("cx", "12");
  spinnerCircle.setAttribute("cy", "12");
  spinnerCircle.setAttribute("r", "9");
  spinnerCircle.setAttribute("fill", "none");
  spinnerCircle.setAttribute("stroke", "#dce6f0");
  spinnerCircle.setAttribute("stroke-width", "3");
  const spinnerArc = document.createElementNS(svgNamespace, "circle");
  spinnerArc.setAttribute("cx", "12");
  spinnerArc.setAttribute("cy", "12");
  spinnerArc.setAttribute("r", "9");
  spinnerArc.setAttribute("fill", "none");
  spinnerArc.setAttribute("stroke", "#2674c8");
  spinnerArc.setAttribute("stroke-width", "3");
  spinnerArc.setAttribute("stroke-linecap", "round");
  spinnerArc.setAttribute("stroke-dasharray", "20 40");
  const spinnerAnimation = document.createElementNS(
    svgNamespace,
    "animateTransform",
  );
  spinnerAnimation.setAttribute("attributeName", "transform");
  spinnerAnimation.setAttribute("type", "rotate");
  spinnerAnimation.setAttribute("from", "0 12 12");
  spinnerAnimation.setAttribute("to", "360 12 12");
  spinnerAnimation.setAttribute("dur", "0.8s");
  spinnerAnimation.setAttribute("repeatCount", "indefinite");
  spinnerArc.append(spinnerAnimation);
  spinner.append(spinnerCircle, spinnerArc);
  const placeholderText = document.createElement("span");
  placeholderText.textContent = "安全验证控件加载中…";
  Object.assign(placeholderText.style, {
    color: "#8995a5",
    fontSize: "12px",
  });
  placeholder.append(spinner, placeholderText);
  slot.append(placeholder);
  card.append(brand, heading, status, slot);
  mask.append(card);
  (document.documentElement ?? document.body)?.append(mask);

  if (document.documentElement && typeof MutationObserver !== "undefined") {
    challengeObserver = new MutationObserver(positionChallenge);
    challengeObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
  window.addEventListener("resize", positionChallenge);
  positionChallenge();
}

export function hideAtCoderSubmitMask(): void {
  hideCrossOjSubmitMask();
}

export function hideCrossOjSubmitMask(): void {
  challengeObserver?.disconnect();
  challengeObserver = undefined;
  window.removeEventListener("resize", positionChallenge);
  for (const [challenge, originalStyle] of originalStyles) {
    if (originalStyle === null) challenge.removeAttribute("style");
    else challenge.setAttribute("style", originalStyle);
  }
  originalStyles.clear();
  if (maskedRoot && originalRootVisibility) {
    if (originalRootVisibility.value) {
      maskedRoot.style.setProperty(
        "visibility",
        originalRootVisibility.value,
        originalRootVisibility.priority,
      );
    } else maskedRoot.style.removeProperty("visibility");
  }
  maskedRoot = undefined;
  originalRootVisibility = undefined;
  document.getElementById(activeMaskId)?.remove();
  activeMaskId = MASK_IDS.atcoder;
}

export function showAtCoderSubmitMask(message: string): void {
  showCrossOjSubmitMask("atcoder", message);
}
