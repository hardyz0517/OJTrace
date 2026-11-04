import { useEffect, useRef, type ReactElement } from "react";
import { isTypstSvg } from "../../src/problem/render/typst-renderer";
import { ProblemCompileError } from "../../src/problem/render/compile-diagnostic";

/** Validate before publishing a preview so a failed update keeps the last one. */
export function parseTypstSvg(svg: string): SVGSVGElement {
  const invalid = () =>
    new ProblemCompileError(
      "source",
      "预览 SVG 数据无效，无法显示。请重新生成预览。",
    );
  if (!isTypstSvg(svg)) throw invalid();
  const parsed = new DOMParser().parseFromString(svg.trim(), "image/svg+xml");
  const graphic = parsed.documentElement;
  if (
    parsed.querySelector("parsererror") ||
    graphic.localName !== "svg" ||
    graphic.namespaceURI !== "http://www.w3.org/2000/svg"
  )
    throw invalid();

  const viewBox = (graphic.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    viewBox.length !== 4 ||
    !viewBox.every(Number.isFinite) ||
    viewBox[2]! <= 0 ||
    viewBox[3]! <= 0
  )
    throw invalid();

  graphic.querySelectorAll("script").forEach((node) => node.remove());
  // The preview is static. Keep drawing styles, glyph links and images, but
  // don't mount the renderer's optional inline interaction handlers.
  for (const node of [graphic, ...graphic.querySelectorAll("*")]) {
    for (const name of node.getAttributeNames()) {
      if (/^on/i.test(name)) node.removeAttribute(name);
    }
  }
  if (
    !graphic.querySelector(
      "path, use, text, image, rect, circle, ellipse, line, polyline, polygon",
    )
  )
    throw invalid();
  return graphic as unknown as SVGSVGElement;
}

/** Mount Typst SVG in a shadow root so page CSS cannot shift the document. */
export function mountTypstSvg(host: HTMLElement, svg: SVGSVGElement): void {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const adopted = document.importNode(svg, true);
  // Size the outer document only; nested SVGs may be used by images/formulas.
  adopted.style.width = "100%";
  adopted.style.height = "auto";
  adopted.style.display = "block";
  root.replaceChildren(adopted);
}

export function TypstPreview({ svg }: { svg: SVGSVGElement }): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host) mountTypstSvg(host, svg);
  }, [svg]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    let scrollRatio = 0;
    let suppress = false;
    const handleScroll = () => {
      if (suppress) {
        suppress = false;
        return;
      }
      scrollRatio = container.scrollTop / Math.max(container.scrollWidth, 1);
    };
    const handleResize = () => {
      const next = scrollRatio * container.scrollWidth;
      if (next + container.clientHeight - 1 <= container.scrollHeight)
        suppress = true;
      container.scrollTop = next;
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="typst-preview-scroll" ref={scrollRef}>
      <div className="typst-preview-host" ref={hostRef} />
    </div>
  );
}
