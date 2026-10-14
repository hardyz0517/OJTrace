import type { TypstCompiler } from "./typst-renderer";
import {
  CODE_THEME_PATH,
  codeThemeBytes,
  MITEX_PACKAGE_KEY,
} from "./code-theme";
import { bundledFontPaths } from "./font-manifest";
import { ProblemCompileError, compileDiagnostic } from "./compile-diagnostic";

interface TypstApi {
  pdf(options: { mainContent: string }): Promise<Uint8Array>;
  mapShadow(path: string, data: Uint8Array): Promise<void>;
  resetShadow(): Promise<void>;
  use(...providers: unknown[]): void;
}

interface PackageSpec {
  namespace?: string;
  name?: string;
  version?: string;
}

interface UntarHost {
  untar(
    archive: Uint8Array,
    visit: (name: string, bytes: Uint8Array, mtime: number) => void,
  ): void;
}

/** In-memory files for packages unpacked from the extension bundle. */
export class BundledAccessModel {
  private readonly mtimes = new Map<string, Date>();
  private readonly data = new Map<string, Uint8Array>();

  insertFile(path: string, bytes: Uint8Array, mtime: Date): void {
    this.mtimes.set(path, mtime);
    this.data.set(path, bytes);
  }

  getMTime(path: string): Date | undefined {
    return path.startsWith("/@memory/") ? this.mtimes.get(path) : undefined;
  }

  isFile(): boolean {
    return true;
  }

  getRealPath(path: string): string {
    return path;
  }

  readAll(path: string): Uint8Array | undefined {
    return path.startsWith("/@memory/") ? this.data.get(path) : undefined;
  }
}

/** Serves preview packages that ship with OJTrace. Never fetches a registry. */
export class BundledPackageRegistry {
  private readonly cache = new Map<string, () => string>();

  constructor(
    private readonly access: BundledAccessModel,
    private readonly archives: ReadonlyMap<string, Uint8Array>,
  ) {}

  resolve(spec: PackageSpec, host: UntarHost): string | undefined {
    const namespace = spec.namespace ?? "";
    const name = spec.name ?? "";
    const version = spec.version ?? "";
    const key = `${namespace}/${name}/${version}`;
    const archive = this.archives.get(key);
    if (!archive) return undefined;
    const cached = this.cache.get(key);
    if (cached) return cached();
    const root = `/@memory/fetch/packages/${namespace}/${name}/${version}`;
    const files: Array<[string, Uint8Array, Date]> = [];
    host.untar(archive, (entry, bytes, mtime) => {
      files.push([`${root}/${entry}`, bytes, new Date(mtime)]);
    });
    const install = (): string => {
      for (const [path, bytes, mtime] of files)
        this.access.insertFile(path, bytes, mtime);
      return root;
    };
    this.cache.set(key, install);
    return install();
  }
}

export function bundledPreviewPackages(
  snippet: {
    withAccessModel: (access: BundledAccessModel) => unknown;
    withPackageRegistry: (registry: BundledPackageRegistry) => unknown;
  },
  archives: ReadonlyMap<string, Uint8Array>,
): readonly [unknown, unknown] {
  const access = new BundledAccessModel();
  const registry = new BundledPackageRegistry(access, archives);
  return [
    snippet.withAccessModel(access),
    snippet.withPackageRegistry(registry),
  ];
}

interface TypstModule {
  $typst: TypstApi;
  TypstSnippet: {
    new (): TypstApi;
    disableDefaultFontAssets?: () => unknown;
    preloadFonts?: (fonts: readonly Uint8Array[]) => unknown;
    withAccessModel: (access: BundledAccessModel) => unknown;
    withPackageRegistry: (registry: BundledPackageRegistry) => unknown;
  };
}

let apiPromise: Promise<TypstApi> | undefined;

async function loadAsset(path: string): Promise<Uint8Array> {
  const extensionPageUrl = browser.runtime.getURL("/problem-export.html");
  const assetUrl = new URL(path.replace(/^\//, ""), extensionPageUrl);
  const response = await fetch(assetUrl);
  if (!response.ok)
    throw new ProblemCompileError(
      "asset",
      "导出所需的字体或资源未能加载，本次没有生成文件。",
      { cause: new Error(path) },
    );
  return new Uint8Array(await response.arrayBuffer());
}

async function loadApi(): Promise<TypstApi> {
  const module =
    (await import("@myriaddreamin/typst-all-in-one.ts")) as unknown as TypstModule;
  const api = module.$typst;
  if (!api || !module.TypstSnippet)
    throw new Error("Typst WASM API is unavailable");

  // The bundled Typst defaults point at a remote font registry. Disable that
  // provider and load only the faces shipped with OJTrace.
  const providers: unknown[] = [
    module.TypstSnippet.disableDefaultFontAssets?.(),
  ].filter((provider) => provider !== undefined);
  const [fonts, mitex] = await Promise.all([
    Promise.all(bundledFontPaths.map((path) => loadAsset(path))),
    loadAsset("/problem-packages/mitex-0.2.5.tar.gz"),
  ]);
  const preloadFonts = module.TypstSnippet.preloadFonts;
  if (!preloadFonts) throw new Error("Typst font loader is unavailable");
  const withAccessModel = module.TypstSnippet.withAccessModel;
  const withPackageRegistry = module.TypstSnippet.withPackageRegistry;
  if (!withAccessModel || !withPackageRegistry)
    throw new Error("Typst package loader is unavailable");
  providers.push(preloadFonts(fonts));
  providers.push(
    ...bundledPreviewPackages(
      { withAccessModel, withPackageRegistry },
      new Map([[MITEX_PACKAGE_KEY, mitex]]),
    ),
  );
  api.use(...providers);
  return api;
}

function typstApi(): Promise<TypstApi> {
  apiPromise ??= loadApi().catch((error) => {
    apiPromise = undefined;
    throw error;
  });
  return apiPromise;
}

let shadowQueue: Promise<void> = Promise.resolve();

function enqueueShadow<T>(task: () => Promise<T>): Promise<T> {
  const run = shadowQueue.then(task, task);
  shadowQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function sourceDiagnostic(error: unknown): ProblemCompileError {
  return new ProblemCompileError("source", compileDiagnostic(error), {
    cause: error,
  });
}

/** Browser-local Typst compiler. It never reaches a remote font or compiler URL. */
export class BrowserTypstCompiler implements TypstCompiler {
  constructor(private readonly apiOverride?: TypstApi) {}

  async compile(
    source: string,
    options?: { assets?: ReadonlyMap<string, Uint8Array> },
  ): Promise<Uint8Array> {
    const api = this.apiOverride ?? (await typstApi());
    return enqueueShadow(async () => {
      await api.resetShadow();
      try {
        await api.mapShadow(CODE_THEME_PATH, codeThemeBytes());
        for (const [path, data] of options?.assets ?? [])
          await api.mapShadow(path, data);
        try {
          return await api.pdf({ mainContent: source });
        } catch (error) {
          throw sourceDiagnostic(error);
        }
      } finally {
        await api.resetShadow();
      }
    });
  }
}
