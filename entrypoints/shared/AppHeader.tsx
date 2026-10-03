import React, { useLayoutEffect, useRef } from "react";
import "./AppHeader.css";

const PAGE_TRANSITION_KEY = "ojtrace-page-transition";
const PAGE_EXIT_DURATION = 110;
const GITHUB_REPOSITORY_URL = "https://github.com/hardyz0517/OJTrace";

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
        <a
          className="app-nav-github"
          href={GITHUB_REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          title="GitHub"
        >
          <svg
            className="app-nav-github-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </a>
      </nav>
    </header>
  );
}
