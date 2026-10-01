import React, { useLayoutEffect, useRef } from "react";
import "./AppHeader.css";

const PAGE_TRANSITION_KEY = "ojtrace-page-transition";
const PAGE_EXIT_DURATION = 110;

export function AppHeader({ active }: { active: "timeline" | "settings" }) {
  const navigationLocked = useRef(false);

  useLayoutEffect(() => {
    let shouldAnimate = false;
    try {
      shouldAnimate = sessionStorage.getItem(PAGE_TRANSITION_KEY) === "enter";
      if (shouldAnimate) sessionStorage.removeItem(PAGE_TRANSITION_KEY);
    } catch {
      // Storage can be unavailable in restricted extension contexts.
    }
    if (!shouldAnimate) return;

    const content = document.querySelector<HTMLElement>(
      ".timeline-page-content, .settings-content",
    );
    if (!content) return;
    content.classList.add("page-content-enter");
    const cleanup = () => content.classList.remove("page-content-enter");
    content.addEventListener("animationend", cleanup, { once: true });
    window.setTimeout(cleanup, 220);
  }, []);

  function navigate(event: React.MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.defaultPrevented
    ) {
      return;
    }

    const target = event.currentTarget.href;
    if (target === window.location.href || navigationLocked.current) return;
    event.preventDefault();
    navigationLocked.current = true;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const content = document.querySelector<HTMLElement>(
      ".timeline-page-content, .settings-content",
    );
    const indicator = document.querySelector<HTMLElement>(".app-nav-indicator");

    if (reducedMotion || !content) {
      window.location.assign(target);
      return;
    }

    content.classList.add("page-content-exit");
    if (indicator) {
      const indicatorRect = indicator.getBoundingClientRect();
      const targetRect = event.currentTarget.getBoundingClientRect();
      const targetIndicatorWidth = Math.max(1, targetRect.width - 20);
      const scale = targetIndicatorWidth / Math.max(1, indicatorRect.width);
      indicator.style.setProperty(
        "--indicator-shift",
        String(targetRect.left - indicatorRect.left) + "px",
      );
      indicator.style.setProperty("--indicator-scale", String(scale));
      requestAnimationFrame(() => indicator.classList.add("is-manual-moving"));
    }

    try {
      sessionStorage.setItem(PAGE_TRANSITION_KEY, "enter");
    } catch {
      // Storage can be unavailable in restricted extension contexts.
    }
    window.setTimeout(() => window.location.assign(target), PAGE_EXIT_DURATION);
  }

  return (
    <header className="app-header">
      <a className="app-brand" href={browser.runtime.getURL("/timeline.html")}>
        <strong>题迹</strong>
        <span>OJTrace</span>
      </a>
      <nav className="app-nav" aria-label="主导航">
        <a
          className={active === "timeline" ? "is-active" : ""}
          href={browser.runtime.getURL("/timeline.html")}
          onClick={navigate}
        >
          时间线
          {active === "timeline" && (
            <span className="app-nav-indicator" aria-hidden="true" />
          )}
        </a>
        <a
          className={active === "settings" ? "is-active" : ""}
          href={browser.runtime.getURL("/settings.html")}
          onClick={navigate}
        >
          设置
          {active === "settings" && (
            <span className="app-nav-indicator" aria-hidden="true" />
          )}
        </a>
      </nav>
    </header>
  );
}
