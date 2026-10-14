import type {
  ProblemPageProbe,
  ProblemPageSnapshot,
  ProblemPreview,
  ProblemExtractionResult,
  ProblemCaptureHints,
} from "../../problem/domain";
import {
  createProblemExportJob,
  deleteProblemExportJob,
  isProblemExportJob,
  readProblemExportJob,
  type ProblemExportJob,
} from "./export-state";
import { openProblemExportPage } from "../navigation/extension-pages";
import {
  IMAGE_COUNT_LIMIT,
  IMAGE_SINGLE_BYTE_LIMIT,
  IMAGE_TOTAL_BYTE_LIMIT,
  PROBLEM_PROBE_HTML_LIMIT,
  PROBLEM_SNAPSHOT_HTML_LIMIT,
} from "../../problem/budget";
import { embeddableImageType } from "../../problem/extract/image-type";
import { normalizeProblemLanguage } from "../../problem/language";
import { mergeCapturedImages } from "../../problem/merge-images";
import { formatProblemMarkdown } from "../../problem/format-problem-markdown";
import {
  problemExportEnvelope,
  type ProblemExportFallbackJob,
  type ProblemExportPortEvent,
} from "./messages";

// Document and Markdown limits are export delivery checks. HTML and image
// ceilings live in src/problem/budget.ts because capture and rendering share them.
export const PROBLEM_DOCUMENT_LIMIT = 5_000_000;
export const PROBLEM_MARKDOWN_LIMIT = 2_000_000;

export interface ProblemAdapterRegistryLike {
  captureHints?(url: string): ProblemCaptureHints | undefined;
  inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined | null>;
  extract(snapshot: ProblemPageSnapshot): Promise<ProblemExtractionResult>;
}

export interface ProblemExportServiceOptions {
  registry: ProblemAdapterRegistryLike;
  now?: () => number;
  captureTimeoutMs?: number;
  /**
   * Extension-context image fetch. Page fetches cannot read cross-origin
   * statement images such as espresso.codeforces.com; the service worker can
   * once the host permission is granted.
   */
  loadImage?: (url: string, signal: AbortSignal) => Promise<Response>;
}

type ExportPort = { postMessage(message: unknown): void };
type ExportTab = { id: number; url: string };

export type ProblemExportServiceErrorCode =
  | "tab_unavailable"
  | "tab_changed"
  | "page_access_denied"
  | "statement_not_found"
  | "job_expired"
  | "job_not_found"
  | "document_too_large"
  | "capture_failed"
  | "extract_failed"
  | "navigation_failed"
  | "cancelled"
  | "job_in_progress";

export class ProblemExportServiceError extends Error {
  constructor(
    readonly code: ProblemExportServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProblemExportServiceError";
  }
}

interface CapturedPage {
  url: string;
  title: string;
  baseUrl: string;
  html: string;
  htmlFragment: string;
  language?: string;
  sourceData?: Record<string, unknown>;
  imageAssets?: Array<{
    sourceUrl: string;
    alt?: string;
    width?: number;
    height?: number;
    dataUrl?: string;
    mimeType?: string;
  }>;
  imageWarnings?: Array<{
    code: string;
    message: string;
  }>;
  truncated: boolean;
}

interface CaptureArgs {
  mode: "probe" | "snapshot";
  htmlLimit: number;
  hints?: ProblemCaptureHints;
}

interface ImageSource {
  sourceUrl: string;
  alt?: string;
  width?: number;
  height?: number;
}

interface ImageCaptureArgs {
  sources: ImageSource[];
  singleByteLimit: number;
  totalByteLimit: number;
  countLimit: number;
}

interface CapturedImageBytes {
  sourceUrl: string;
  base64?: string;
  contentType?: string;
}

const PROBLEM_CAPTURE_TIMEOUT_MS = 30_000;

/** Executed in the page context by scripting.executeScript. */
async function capturePage(args: CaptureArgs): Promise<CapturedPage> {
  const currentUrl = window.location.href;
  const sourceData: Record<string, unknown> = {};
  let sourceTooLarge = false;
  if (args.mode === "snapshot") {
    for (const hint of args.hints?.jsonScripts ?? []) {
      const script = document.querySelector(hint.selector);
      const scriptType = script?.getAttribute("type")?.toLowerCase() ?? "";
      if (
        script?.tagName !== "SCRIPT" ||
        (scriptType !== "" &&
          scriptType !== "application/json" &&
          scriptType !== "application/ld+json" &&
          !scriptType.endsWith("+json"))
      )
        continue;
      const text = script.textContent ?? "";
      if (text.length > args.htmlLimit) {
        sourceTooLarge = true;
        continue;
      }
      try {
        let value: unknown = JSON.parse(text);
        for (const key of hint.path) {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            value = undefined;
            break;
          }
          value = (value as Record<string, unknown>)[key];
        }
        if (!value || typeof value !== "object" || Array.isArray(value))
          continue;
        const fields = value as Record<string, unknown>;
        sourceData[hint.key] = Object.fromEntries(
          hint.fields
            .filter((key) => Object.hasOwn(fields, key))
            .map((key) => [key, fields[key]]),
        );
      } catch {
        // A malformed source leaves DOM extraction available.
      }
    }
  }
  const sourceElements = Array.from(document.body?.querySelectorAll("*") ?? []);
  const hiddenIndexes = new Set<number>();
  sourceElements.forEach((element, index) => {
    let style: CSSStyleDeclaration | undefined;
    try {
      style = window.getComputedStyle(element);
    } catch {
      style = undefined;
    }
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      element.hasAttribute("hidden") ||
      element.getAttribute("aria-hidden") === "true"
    )
      hiddenIndexes.add(index);
  });
  const root = document.body?.cloneNode(true) as HTMLElement | null;
  if (!root) throw new Error("document body is unavailable");
  const mathSource = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute("type")?.toLowerCase() ?? "";
    return (
      tag === "math" ||
      tag === "mjx-container" ||
      (tag === "script" &&
        (type.startsWith("math/tex") || type === "application/x-tex")) ||
      element.matches(
        ".katex, .katex-mathml, .katex-display, .mathjax, .MathJax, .MathJax_Display, mjx-container, [data-math], [alttext], annotation",
      )
    );
  };
  const clonedElements = Array.from(root.querySelectorAll("*"));
  for (let index = clonedElements.length - 1; index >= 0; index -= 1) {
    const element = clonedElements[index];
    if (
      element &&
      hiddenIndexes.has(index) &&
      !mathSource(element) &&
      !element.closest(
        ".katex, .katex-display, .MathJax, .MathJax_Display, mjx-container, math",
      )
    )
      element.remove();
  }
  root
    .querySelectorAll("style,noscript,template,iframe,object,embed")
    .forEach((node) => node.remove());
  for (const script of Array.from(root.querySelectorAll("script"))) {
    const type = script.getAttribute("type")?.toLowerCase() ?? "";
    if (!(type.startsWith("math/tex") || type === "application/x-tex"))
      script.remove();
  }
  if (args.mode === "probe") {
    const walker = document.createTreeWalker(root, 4);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.length > 256) textNodes.push(node);
    }
    for (const node of textNodes) node.data = `${node.data.slice(0, 256)}…`;
    for (const element of Array.from(root.querySelectorAll("pre,textarea"))) {
      if (element.textContent && element.textContent.length > 256)
        element.textContent = `${element.textContent.slice(0, 256)}…`;
    }
    for (const list of Array.from(root.querySelectorAll("ol,ul"))) {
      const children = Array.from(list.children);
      for (const child of children.slice(80)) child.remove();
    }
    for (const table of Array.from(root.querySelectorAll("table"))) {
      const rows = Array.from(table.querySelectorAll("tr"));
      for (const row of rows.slice(40)) row.remove();
    }
    for (const image of Array.from(root.querySelectorAll("img"))) {
      image.removeAttribute("srcset");
      image.removeAttribute("sizes");
    }
    for (const element of Array.from(root.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.toLowerCase().startsWith("on"))
          element.removeAttribute(attribute.name);
        else if (attribute.value.length > 512)
          element.setAttribute(attribute.name, attribute.value.slice(0, 512));
      }
    }
    let remainingNodes = 4_000;
    const prune = (parent: Element): void => {
      for (const child of Array.from(parent.children)) {
        remainingNodes -= 1;
        if (remainingNodes < 0) {
          child.remove();
          continue;
        }
        prune(child);
      }
    };
    prune(root);
  }
  // Keep the bounded, cleaned body for both probe and snapshot. Adapters own
  // their OJ-specific root selection; a generic fragment would drop titles and
  // limits that live beside the statement (notably AtCoder/QOJ/Hydro).
  const html = root.outerHTML;
  const fragment = html;
  const truncated = html.length > args.htmlLimit || sourceTooLarge;

  return {
    url: currentUrl,
    title: document.title.trim(),
    baseUrl: document.baseURI || currentUrl,
    html: html.slice(0, args.htmlLimit),
    htmlFragment: fragment.slice(0, args.htmlLimit),
    language: document.documentElement.lang || undefined,
    ...(Object.keys(sourceData).length ? { sourceData } : {}),
    truncated,
  };
}

/** Executed in the page context only after an Adapter identified statement images. */
async function captureImages(args: ImageCaptureArgs): Promise<{
  images: CapturedImageBytes[];
  imageWarnings: NonNullable<CapturedPage["imageWarnings"]>;
}> {
  // Like capturePage, this function is serialized into the target page.
  const IMAGE_TOTAL_TIMEOUT_MS = 15_000;
  const IMAGE_SINGLE_TIMEOUT_MS = 5_000;
  const images: CapturedImageBytes[] = [];
  const imageWarnings: NonNullable<CapturedPage["imageWarnings"]> = [];
  const startedAt = performance.now();
  let totalBytes = 0;

  const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(index, index + chunkSize),
      );
    }
    return btoa(binary);
  };

  const readBody = async (
    response: Response,
  ): Promise<Uint8Array | undefined> => {
    const length = Number(response.headers.get("content-length") ?? 0);
    if (
      Number.isFinite(length) &&
      length > 0 &&
      (length > args.singleByteLimit ||
        totalBytes + length > args.totalByteLimit)
    )
      return undefined;
    if (!response.body) {
      const value = new Uint8Array(await response.arrayBuffer());
      return value.byteLength <= args.singleByteLimit ? value : undefined;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        if (!part.value) continue;
        size += part.value.byteLength;
        if (
          size > args.singleByteLimit ||
          totalBytes + size > args.totalByteLimit
        ) {
          await reader.cancel();
          return undefined;
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  };

  const seen = new Set<string>();
  const sources = args.sources.slice(0, args.countLimit);
  for (const source of sources) {
    const sourceUrl = source.sourceUrl;
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    if (performance.now() - startedAt >= IMAGE_TOTAL_TIMEOUT_MS) {
      imageWarnings.push({
        code: "image-time-limit",
        message: "题面图片采集超时，未完成的图片已保留原图链接。",
      });
      break;
    }
    try {
      const parsedUrl = new URL(sourceUrl, document.baseURI);
      if (!/^https?:$/i.test(parsedUrl.protocol))
        throw new Error("unsupported image URL");
      const controller = new AbortController();
      const remaining = Math.max(
        1,
        IMAGE_TOTAL_TIMEOUT_MS - (performance.now() - startedAt),
      );
      const timeout = window.setTimeout(
        () => controller.abort(),
        Math.min(IMAGE_SINGLE_TIMEOUT_MS, remaining),
      );
      try {
        const response = await fetch(parsedUrl.href, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType =
          response.headers
            .get("content-type")
            ?.split(";", 1)[0]
            ?.trim()
            .toLowerCase() ?? "";
        const bytes = await readBody(response);
        if (!bytes) throw new Error("image exceeds the export size limit");
        totalBytes += bytes.byteLength;
        images.push({
          sourceUrl,
          base64: bytesToBase64(bytes),
          contentType,
        });
      } finally {
        window.clearTimeout(timeout);
      }
    } catch {
      imageWarnings.push({
        code: "image-unembedded",
        message: `图片无法嵌入 PDF，已保留原图链接：${sourceUrl}`,
      });
    }
  }
  if (args.sources.length > args.countLimit)
    imageWarnings.push({
      code: "image-count-limit",
      message: `超出 ${args.countLimit} 张图片采集上限的题面图片未嵌入 PDF。`,
    });
  return { images, imageWarnings };
}
function dataUrlBytes(dataUrl: string | undefined): number {
  if (!dataUrl) return 0;
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function requestId(): string {
  return crypto.randomUUID();
}

function stringSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export class ProblemExportService {
  private readonly registry: ProblemAdapterRegistryLike;
  private readonly now: () => number;
  private readonly captureTimeoutMs: number;
  private readonly loadImage: (
    url: string,
    signal: AbortSignal,
  ) => Promise<Response>;
  private readonly activeExports = new Map<string, AbortController>();

  constructor(options: ProblemExportServiceOptions) {
    this.registry = options.registry;
    this.now = options.now ?? Date.now;
    this.captureTimeoutMs = Math.max(
      1,
      options.captureTimeoutMs ?? PROBLEM_CAPTURE_TIMEOUT_MS,
    );
    this.loadImage =
      options.loadImage ??
      ((url, signal) => fetch(url, { credentials: "omit", signal }));
  }

  async inspect(
    tabId: number,
    expectedUrl?: string,
  ): Promise<ProblemPreview | null> {
    const tab = await this.getTab(tabId);
    this.assertExpectedUrl(tab.url, expectedUrl);
    if (!isInjectablePageUrl(tab.url)) return null;
    const page = await this.capture(tabId, expectedUrl, "probe");
    const preview = await this.registry.inspect({
      url: page.url,
      title: page.title,
      htmlFragment: page.htmlFragment,
      baseUrl: page.baseUrl,
    });
    return preview ?? null;
  }

  async extractMarkdown(tabId: number, expectedUrl?: string): Promise<string> {
    try {
      return await this.readProblemMarkdown(tabId, expectedUrl);
    } catch (error) {
      if (
        error instanceof ProblemExportServiceError &&
        error.code === "tab_changed"
      ) {
        throw new ProblemExportServiceError(
          "tab_changed",
          "当前页面已发生变化，请重新识别题目后复制。",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async readProblemMarkdown(
    tabId: number,
    expectedUrl?: string,
  ): Promise<string> {
    const page = await this.capture(tabId, expectedUrl, "snapshot");
    const extraction = await this.withCancellation(
      this.registry.extract({
        url: page.url,
        title: page.title,
        html: page.html,
        baseUrl: page.baseUrl,
        language: normalizeProblemLanguage(page.language),
        sourceData: page.sourceData,
        imageAssets: page.imageAssets,
        imageWarnings: page.imageWarnings,
        capturedAt: this.now(),
      }),
      undefined,
      this.captureTimeoutMs,
    );
    if (!extraction.ok)
      throw new ProblemExportServiceError(
        extraction.reason === "size-limit"
          ? "document_too_large"
          : "extract_failed",
        extraction.message ?? "当前页面没有可复制的题面。",
      );
    if (!extraction.document.markdown.trim())
      throw new ProblemExportServiceError(
        "extract_failed",
        "当前页面没有可复制的题面。",
      );
    const markdown = formatProblemMarkdown(extraction.document);
    if (stringSize(markdown) > PROBLEM_MARKDOWN_LIMIT)
      throw new ProblemExportServiceError(
        "document_too_large",
        "题面内容过大，无法复制。",
      );
    return markdown;
  }

  async start(tabId: number, expectedUrl?: string): Promise<ProblemExportJob> {
    const page = await this.getTab(tabId);
    this.assertExpectedUrl(page.url, expectedUrl);
    let job: ProblemExportJob | undefined;
    try {
      job = await createProblemExportJob({
        tabId,
        expectedUrl: page.url,
        now: this.now(),
      });
      await openProblemExportPage(job);
      return job;
    } catch (error) {
      if (job) await deleteProblemExportJob(job.token).catch(() => {});
      if (error instanceof ProblemExportServiceError) throw error;
      throw new ProblemExportServiceError(
        "navigation_failed",
        "无法打开题面导出页面，请重试。",
        { cause: error },
      );
    }
  }

  async deliver(
    port: ExportPort,
    token: string,
    fallbackJob?: ProblemExportFallbackJob,
  ): Promise<void> {
    if (this.activeExports.has(token)) {
      this.sendError(
        port,
        token,
        "job_in_progress",
        "导出任务已在另一个页面中进行。",
      );
      return;
    }
    const controller = new AbortController();
    this.activeExports.set(token, controller);
    const request = requestId();
    let timedOut = false;
    let extracted = false;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    const imageController = new AbortController();
    const abortImages = () => imageController.abort();
    controller.signal.addEventListener("abort", abortImages);
    try {
      let job = await readProblemExportJob(token, this.now());
      if (
        !job &&
        fallbackJob &&
        fallbackJob.token === token &&
        isProblemExportJob(fallbackJob) &&
        fallbackJob.expiresAt > this.now()
      ) {
        // The page carries only the metadata created by this extension. It is
        // a recovery path for a transient storage visibility gap; capture()
        // still verifies the tab URL before touching the page.
        job = fallbackJob;
      }
      this.throwIfCancelled(controller.signal);
      if (!job) {
        this.sendError(
          port,
          token,
          "job_not_found",
          "导出任务已失效，请重新发起导出。",
        );
        return;
      }
      totalTimer = setTimeout(() => {
        timedOut = true;
        if (extracted) imageController.abort();
        else controller.abort();
      }, this.captureTimeoutMs * 3);
      this.send(port, {
        ...problemExportEnvelope(request),
        type: "PROBLEM_EXPORT_PROGRESS",
        token,
        phase: "capturing",
      });
      const page = await this.capture(
        job.tabId,
        job.expectedUrl,
        "snapshot",
        controller.signal,
      );
      this.throwIfCancelled(controller.signal);
      this.send(port, {
        ...problemExportEnvelope(request),
        type: "PROBLEM_EXPORT_PROGRESS",
        token,
        phase: "extracting",
      });
      const extraction = await this.withCancellation(
        this.registry.extract({
          url: page.url,
          title: page.title,
          html: page.html,
          baseUrl: page.baseUrl,
          language: normalizeProblemLanguage(page.language),
          sourceData: page.sourceData,
          imageAssets: page.imageAssets,
          imageWarnings: page.imageWarnings,
          capturedAt: this.now(),
        }),
        controller.signal,
        this.captureTimeoutMs,
      );
      this.throwIfCancelled(controller.signal);
      if (!extraction.ok)
        throw new ProblemExportServiceError(
          extraction.reason === "size-limit"
            ? "document_too_large"
            : "extract_failed",
          extraction.message ?? "当前页面没有可导出的题面。",
        );
      let document = extraction.document;
      extracted = true;
      if (document.assets.length > 0) {
        let capturedImages: {
          imageAssets: NonNullable<CapturedPage["imageAssets"]>;
          imageWarnings: NonNullable<CapturedPage["imageWarnings"]>;
        };
        try {
          capturedImages = await this.captureImages(
            job.tabId,
            job.expectedUrl,
            document.assets,
            imageController.signal,
          );
        } catch (error) {
          if (controller.signal.aborted) throw error;
          if (
            error instanceof ProblemExportServiceError &&
            error.code === "tab_changed"
          )
            throw error;
          if (
            !(error instanceof ProblemExportServiceError) ||
            !["capture_failed", "page_access_denied", "cancelled"].includes(
              error.code,
            )
          )
            throw error;
          capturedImages = {
            imageAssets: [],
            imageWarnings: document.assets.map((asset) => ({
              code: "image-unembedded",
              message: `图片无法嵌入 PDF，已保留原图链接：${asset.sourceUrl}`,
            })),
          };
        }
        if (controller.signal.aborted) throw this.cancelledError();
        const merged = mergeCapturedImages(
          document.assets,
          document.warnings,
          capturedImages.imageAssets,
          capturedImages.imageWarnings,
        );
        document = {
          ...document,
          assets: merged.assets,
          warnings: merged.warnings,
        };
      }
      if (stringSize(document) > PROBLEM_DOCUMENT_LIMIT)
        throw new ProblemExportServiceError(
          "document_too_large",
          "题面内容过大，无法在扩展内完成导出。",
        );
      this.send(port, {
        ...problemExportEnvelope(request),
        type: "PROBLEM_EXPORT_PROGRESS",
        token,
        phase: "ready",
      });
      const delivered = this.send(port, {
        ...problemExportEnvelope(request),
        type: "PROBLEM_EXPORT_DOCUMENT",
        token,
        document,
      });
      // Delete only after the complete document has been handed to the
      // export page. If the port closes before this point, the short-lived
      // job remains available for one automatic/manual retry.
      if (delivered) await deleteProblemExportJob(token);
    } catch (error) {
      if (controller.signal.aborted) {
        if (timedOut)
          this.sendError(
            port,
            token,
            "capture_failed",
            "题面导出处理超时，请重试。",
          );
        return;
      }
      await deleteProblemExportJob(token).catch(() => {});
      const serviceError =
        error instanceof ProblemExportServiceError
          ? error
          : new ProblemExportServiceError(
              "extract_failed",
              "题面提取失败，请确认页面已加载完成。",
              { cause: error },
            );
      this.sendError(port, token, serviceError.code, serviceError.message);
    } finally {
      controller.signal.removeEventListener("abort", abortImages);
      if (totalTimer !== undefined) clearTimeout(totalTimer);
      if (this.activeExports.get(token) === controller)
        this.activeExports.delete(token);
    }
  }

  async cancel(token: string): Promise<void> {
    this.activeExports.get(token)?.abort();
  }

  private async capture(
    tabId: number,
    expectedUrl: string | undefined,
    mode: "probe" | "snapshot",
    signal?: AbortSignal,
  ): Promise<CapturedPage> {
    this.throwIfCancelled(signal);
    const page = await this.getTab(tabId);
    this.assertExpectedUrl(page.url, expectedUrl);
    if (!isInjectablePageUrl(page.url))
      throw new ProblemExportServiceError(
        "page_access_denied",
        "当前页面无法读取，请切换到题目页后重试。",
      );
    let results: Array<{ result?: CapturedPage }>;
    try {
      const execution = browser.scripting.executeScript({
        target: { tabId },
        func: capturePage,
        args: [
          {
            mode,
            hints: this.registry.captureHints?.(page.url),
            htmlLimit:
              mode === "probe"
                ? PROBLEM_PROBE_HTML_LIMIT
                : PROBLEM_SNAPSHOT_HTML_LIMIT,
          },
        ],
      });
      results = await this.withCancellation(
        execution,
        signal,
        this.captureTimeoutMs,
      );
    } catch (error) {
      if (signal?.aborted) throw this.cancelledError();
      if (error instanceof ProblemExportServiceError) throw error;
      throw new ProblemExportServiceError(
        "capture_failed",
        "无法读取当前页面，请确认页面已加载完成。",
        { cause: error },
      );
    }
    const value = results[0]?.result;
    if (!value || typeof value !== "object" || !value.url || !value.html)
      throw new ProblemExportServiceError(
        "capture_failed",
        "当前页面没有可读取的题面内容。",
      );
    this.throwIfCancelled(signal);
    const latest = await this.getTab(tabId);
    if (latest.url !== value.url)
      throw new ProblemExportServiceError(
        "tab_changed",
        "当前页面已发生变化，请重新识别题目后导出。",
      );
    this.assertExpectedUrl(latest.url, expectedUrl);
    if (value.truncated)
      throw new ProblemExportServiceError(
        "document_too_large",
        "当前题面页面内容过大，无法在扩展内安全完成导出。",
      );
    return value;
  }

  private async captureImages(
    tabId: number,
    expectedUrl: string | undefined,
    assets: readonly NonNullable<CapturedPage["imageAssets"]>[number][],
    signal: AbortSignal,
  ): Promise<{
    imageAssets: NonNullable<CapturedPage["imageAssets"]>;
    imageWarnings: NonNullable<CapturedPage["imageWarnings"]>;
  }> {
    this.throwIfCancelled(signal);
    const page = await this.getTab(tabId);
    this.assertExpectedUrl(page.url, expectedUrl);
    let result: Array<{
      result?: {
        images?: CapturedImageBytes[];
        imageWarnings?: NonNullable<CapturedPage["imageWarnings"]>;
      };
    }>;
    try {
      const execution = browser.scripting.executeScript({
        target: { tabId },
        func: captureImages,
        args: [
          {
            sources: assets.map(({ sourceUrl, alt, width, height }) => ({
              sourceUrl,
              ...(alt ? { alt } : {}),
              ...(width === undefined ? {} : { width }),
              ...(height === undefined ? {} : { height }),
            })),
            singleByteLimit: IMAGE_SINGLE_BYTE_LIMIT,
            totalByteLimit: IMAGE_TOTAL_BYTE_LIMIT,
            countLimit: IMAGE_COUNT_LIMIT,
          },
        ],
      });
      result = await this.withCancellation(
        execution,
        signal,
        this.captureTimeoutMs,
      );
    } catch (error) {
      if (signal.aborted) return this.unembeddedImages(assets);
      if (error instanceof ProblemExportServiceError) throw error;
      throw new ProblemExportServiceError(
        "capture_failed",
        "无法读取题面图片，请确认页面已加载完成。",
        { cause: error },
      );
    }
    this.throwIfCancelled(signal);
    const latest = await this.getTab(tabId);
    if (latest.url !== page.url)
      throw new ProblemExportServiceError(
        "tab_changed",
        "当前页面已发生变化，请重新识别题目后导出。",
      );
    const value = result[0]?.result;
    const imageWarnings = [...(value?.imageWarnings ?? [])];
    const imageAssets: NonNullable<CapturedPage["imageAssets"]> = [];
    for (const image of value?.images ?? []) {
      if (!image?.base64 || !image.sourceUrl) continue;
      try {
        const bytes = base64ToBytes(image.base64);
        const mimeType = embeddableImageType(image.contentType, bytes);
        if (!mimeType) throw new Error("unsupported image format");
        const source = assets.find(
          (asset) => asset.sourceUrl === image.sourceUrl,
        );
        imageAssets.push({
          sourceUrl: image.sourceUrl,
          ...(source?.alt ? { alt: source.alt } : {}),
          ...(source?.width === undefined ? {} : { width: source.width }),
          ...(source?.height === undefined ? {} : { height: source.height }),
          dataUrl: bytesToDataUrl(bytes, mimeType),
          mimeType,
        });
      } catch {
        imageWarnings.push({
          code: "image-unembedded",
          message: `图片无法嵌入 PDF，已保留原图链接：${image.sourceUrl}`,
        });
      }
    }
    return this.fetchMissingImages(
      assets,
      { imageAssets, imageWarnings },
      signal,
    );
  }

  private unembeddedImages(
    assets: readonly NonNullable<CapturedPage["imageAssets"]>[number][],
  ): {
    imageAssets: NonNullable<CapturedPage["imageAssets"]>;
    imageWarnings: NonNullable<CapturedPage["imageWarnings"]>;
  } {
    return {
      imageAssets: [],
      imageWarnings: assets.map((asset) => ({
        code: "image-unembedded",
        message: `图片无法嵌入 PDF，已保留原图链接：${asset.sourceUrl}`,
      })),
    };
  }

  private async fetchMissingImages(
    requested: readonly NonNullable<CapturedPage["imageAssets"]>[number][],
    captured: {
      imageAssets: NonNullable<CapturedPage["imageAssets"]>;
      imageWarnings: NonNullable<CapturedPage["imageWarnings"]>;
    },
    parentSignal: AbortSignal,
  ): Promise<{
    imageAssets: NonNullable<CapturedPage["imageAssets"]>;
    imageWarnings: NonNullable<CapturedPage["imageWarnings"]>;
  }> {
    const imageAssets = [...captured.imageAssets];
    const embeddedUrls = new Set(
      imageAssets
        .filter((asset) => asset.dataUrl)
        .map((asset) => asset.sourceUrl),
    );
    const warnings = [...captured.imageWarnings];
    let totalBytes = imageAssets.reduce(
      (sum, asset) => sum + dataUrlBytes(asset.dataUrl),
      0,
    );
    for (const source of requested) {
      if (!source.sourceUrl || embeddedUrls.has(source.sourceUrl)) continue;
      if (parentSignal.aborted) {
        warnings.push({
          code: "image-unembedded",
          message: `图片无法嵌入 PDF，已保留原图链接：${source.sourceUrl}`,
        });
        continue;
      }
      try {
        const embedded = await this.readExtensionImage(
          source.sourceUrl,
          parentSignal,
          totalBytes,
        );
        if (!embedded) throw new Error("image exceeds the export size limit");
        totalBytes += embedded.bytes;
        imageAssets.push({
          ...source,
          sourceUrl: embedded.sourceUrl,
          dataUrl: embedded.dataUrl,
          mimeType: embedded.mimeType,
        });
        embeddedUrls.add(source.sourceUrl);
        embeddedUrls.add(embedded.sourceUrl);
      } catch {
        const message = `图片无法嵌入 PDF，已保留原图链接：${source.sourceUrl}`;
        if (
          !warnings.some(
            (warning) =>
              warning.code === "image-unembedded" &&
              warning.message.endsWith(`：${source.sourceUrl}`),
          )
        )
          warnings.push({ code: "image-unembedded", message });
      }
    }
    return { imageAssets, imageWarnings: warnings };
  }

  private async readExtensionImage(
    sourceUrl: string,
    parentSignal: AbortSignal,
    totalBytes: number,
  ): Promise<
    | { sourceUrl: string; dataUrl: string; mimeType: string; bytes: number }
    | undefined
  > {
    const url = new URL(sourceUrl);
    if (!/^https?:$/i.test(url.protocol))
      throw new Error("unsupported image URL");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const abort = () => controller.abort();
    parentSignal.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.loadImage(url.href, controller.signal);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (
        bytes.byteLength > IMAGE_SINGLE_BYTE_LIMIT ||
        totalBytes + bytes.byteLength > IMAGE_TOTAL_BYTE_LIMIT
      )
        return undefined;
      const mimeType = embeddableImageType(
        response.headers.get("content-type"),
        bytes,
      );
      if (!mimeType) throw new Error("unsupported image format");
      return {
        sourceUrl,
        dataUrl: bytesToDataUrl(bytes, mimeType),
        mimeType,
        bytes: bytes.byteLength,
      };
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abort);
    }
  }

  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw this.cancelledError();
  }

  private cancelledError(): ProblemExportServiceError {
    return new ProblemExportServiceError("cancelled", "题面导出已取消。");
  }

  private withCancellation<T>(
    promise: Promise<T>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<T> {
    if (!signal && !timeoutMs) return promise;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = timeoutMs
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(
              new ProblemExportServiceError(
                "capture_failed",
                "读取题面超时，请确认页面已加载完成后重试。",
              ),
            );
          }, timeoutMs)
        : undefined;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(this.cancelledError());
      };
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      );
    });
  }

  private async getTab(tabId: number): Promise<ExportTab> {
    try {
      const tab = await browser.tabs.get(tabId);
      if (typeof tab.id !== "number" || !tab.url)
        throw new Error("tab is unavailable");
      return { id: tab.id, url: tab.url };
    } catch (error) {
      throw new ProblemExportServiceError(
        "tab_unavailable",
        "当前标签页已关闭，请重新打开题目页。",
        { cause: error },
      );
    }
  }

  private assertExpectedUrl(
    currentUrl: string | undefined,
    expectedUrl?: string,
  ) {
    if (expectedUrl && currentUrl !== expectedUrl)
      throw new ProblemExportServiceError(
        "tab_changed",
        "当前页面已发生变化，请重新识别题目后导出。",
      );
  }

  private send(port: ExportPort, event: ProblemExportPortEvent): boolean {
    try {
      port.postMessage(event);
      return true;
    } catch {
      // The export tab may be closed while capture is running.
      return false;
    }
  }

  private sendError(
    port: ExportPort,
    token: string,
    code: string,
    message: string,
  ): void {
    this.send(port, {
      ...problemExportEnvelope(requestId()),
      type: "PROBLEM_EXPORT_ERROR",
      token,
      code,
      error: message,
    });
  }
}

function isInjectablePageUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
