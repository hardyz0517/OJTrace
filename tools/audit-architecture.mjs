import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { API } from "typescript/unstable/sync";
import { isTypeNode, SyntaxKind } from "typescript/unstable/ast";

const canonical = (path) =>
  process.platform === "win32"
    ? path.replaceAll("\\", "/").toLowerCase()
    : path.replaceAll("\\", "/");
const erasedBindings = (bindings) =>
  bindings?.elements?.length > 0 &&
  bindings.elements.every((item) => item.isTypeOnly);

/** Narrow runtime dependency gate. Resolution uses the project's compiler config. */
export function auditArchitecture({
  root = process.cwd(),
  project = resolve(root, "tsconfig.json"),
} = {}) {
  const api = new API({ cwd: root });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({ openProjects: [project] });
    const configured = snapshot.getProject(project);
    if (!configured)
      throw new Error(`Cannot load architecture project: ${project}`);
    const { program, checker, compilerOptions } = configured;
    const rootPath = canonical(resolve(root));
    const localName = (file) =>
      relative(rootPath, canonical(file)).replaceAll("\\", "/");
    const local = (file) =>
      !localName(file).startsWith("../") &&
      !canonical(file).includes("/node_modules/");
    const aliases = Object.keys(compilerOptions.paths ?? {}).map(
      (key) => key.split("*")[0],
    );
    const graph = new Map();
    const problems = new Map();
    for (const file of program
      .getSourceFileNames()
      .filter((file) => local(file) && !file.endsWith(".d.ts"))) {
      const source = program.getSourceFile(file);
      if (!source) throw new Error(`Cannot parse ${file}`);
      const edges = [];
      const issues = [];
      if (program.getSyntacticDiagnostics(file).length)
        issues.push("source has parse diagnostics");
      const add = (literal) => {
        const specifier = literal.text;
        if (["wxt/browser", "webextension-polyfill"].includes(specifier))
          issues.push(`browser global module ${specifier}`);
        // CSS/assets have no runtime TypeScript closure; require the actual file.
        if (/\.(css|svg|png)$/.test(specifier) && specifier.startsWith(".")) {
          if (!existsSync(resolve(dirname(file), specifier)))
            issues.push(`missing asset ${specifier}`);
          return;
        }
        const declarations =
          checker.getSymbolAtLocation(literal)?.declarations ?? [];
        const targets = [
          ...new Set(declarations.map((declaration) => declaration.path)),
        ];
        if (
          !targets.length &&
          (specifier.startsWith(".") ||
            aliases.some((prefix) => specifier.startsWith(prefix)))
        ) {
          issues.push(`unresolved local runtime import ${specifier}`);
        }
        for (const target of targets)
          if (local(target) && !target.endsWith(".d.ts"))
            edges.push(canonical(target));
      };
      const visit = (node) => {
        if (
          isTypeNode(node) ||
          node.kind === SyntaxKind.InterfaceDeclaration ||
          node.kind === SyntaxKind.TypeAliasDeclaration
        )
          return;
        if (node.kind === SyntaxKind.ImportDeclaration) {
          const clause = node.importClause;
          if (
            !clause?.isTypeOnly &&
            !(clause && !clause.name && erasedBindings(clause.namedBindings))
          )
            add(node.moduleSpecifier);
          return;
        }
        if (node.kind === SyntaxKind.ImportEqualsDeclaration) {
          if (
            !node.isTypeOnly &&
            node.moduleReference.kind === SyntaxKind.ExternalModuleReference
          ) {
            const target = node.moduleReference.expression;
            if (target?.kind === SyntaxKind.StringLiteral) add(target);
            else issues.push("non-literal runtime module load");
          }
          return;
        }
        if (
          node.kind === SyntaxKind.ExportDeclaration &&
          node.moduleSpecifier
        ) {
          if (!node.isTypeOnly && !erasedBindings(node.exportClause))
            add(node.moduleSpecifier);
          return;
        }
        if (
          node.kind === SyntaxKind.CallExpression &&
          (node.expression.kind === SyntaxKind.ImportKeyword ||
            (node.expression.kind === SyntaxKind.Identifier &&
              node.expression.text === "require"))
        ) {
          const target = node.arguments[0];
          if (
            target?.kind === SyntaxKind.StringLiteral ||
            target?.kind === SyntaxKind.NoSubstitutionTemplateLiteral
          )
            add(target);
          else issues.push("non-literal runtime module load");
        }
        if (
          node.kind === SyntaxKind.Identifier &&
          [
            "browser",
            "chrome",
            "window",
            "document",
            "localStorage",
            "sessionStorage",
          ].includes(node.text) &&
          !(
            node.parent?.kind === SyntaxKind.PropertyAccessExpression &&
            node.parent.name === node
          ) &&
          !(checker.getSymbolAtLocation(node)?.declarations ?? []).some(
            (declaration) =>
              local(declaration.path) && !declaration.path.endsWith(".d.ts"),
          )
        ) {
          issues.push(`browser global ${node.text}`);
        }
        node.forEachChild(visit);
      };
      visit(source);
      graph.set(canonical(file), edges);
      problems.set(canonical(file), issues);
    }
    const errors = [];
    const pureForbidden =
      /^(src\/(application|adapters|platform)\/|entrypoints\/)/;
    const adapterEntry =
      /^src\/adapters\/(?:index\.[cm]?[jt]s|(?!shared\/)[^/]+\/index\.[cm]?[jt]sx?)$/;
    for (const [start] of graph) {
      const name = localName(start);
      const pure = /^src\/(domain|sources)\//.test(name);
      const ui = /^entrypoints\/(settings|timeline|shared)\//.test(name);
      if (!pure && !ui) continue;
      const seen = new Set();
      const walk = (file, path) => {
        if (seen.has(file)) return;
        seen.add(file);
        if (!graph.has(file)) {
          errors.push(`${path.join(" -> ")}: unresolved runtime source`);
          return;
        }
        for (const issue of problems.get(file) ?? []) {
          if (pure || !issue.startsWith("browser global"))
            errors.push(`${path.join(" -> ")}: ${issue}`);
        }
        for (const next of graph.get(file)) {
          const nextName = localName(next);
          const nextPath = [...path, nextName];
          if (
            (pure && pureForbidden.test(nextName)) ||
            (ui && adapterEntry.test(nextName))
          )
            errors.push(nextPath.join(" -> "));
          else walk(next, nextPath);
        }
      };
      walk(start, [name]);
    }
    return [...new Set(errors)];
  } finally {
    snapshot?.dispose();
    api.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const errors = auditArchitecture();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("Architecture runtime dependency audit passed.");
}
