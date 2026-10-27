import { posix, relative } from 'node:path';
import { parseSync, Visitor } from 'oxc-parser';

export function importsOf(filename: string, code: string): string[] {
  const { program, errors } = parseSync(filename, code);

  if (errors.length) throw new Error(`Unable to analyze ${filename}: ${errors[0]?.message}`);

  const imports: string[] = [];
  const visitor = new Visitor({
    ImportDeclaration(node) {
      imports.push(node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (node.source) imports.push(node.source.value);
    },
    ExportAllDeclaration(node) {
      imports.push(node.source.value);
    },
    ImportExpression(node) {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string')
        imports.push(node.source.value);
    },
  });

  visitor.visit(program);

  return imports;
}

export function resolveSourceImport(filename: string, specifier: string): string | undefined {
  const path = filename.replaceAll('\\', '/');
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(path), specifier));

  const workspace = path.match(/^(.*?apps\/[^/]+)\/src\//)?.[1];
  const alias = specifier.match(/^@(app|features|shared|modules|runtime)\/(.+)$/);
  if (!workspace || !alias) return undefined;
  return posix.normalize(`${workspace}/src/${alias[1]}/${alias[2]}`);
}

const defaultExports = new Map([['ui', new Set(['./styles.css', './theme.css'])]]);

export function analyzeSource(
  filename: string,
  code: string,
  publicExports: ReadonlyMap<string, ReadonlySet<string>> = defaultExports,
): string[] {
  const path = filename.replaceAll('\\', '/');
  const issues: string[] = [];
  const browser = /^(apps\/(viewer-web|desktop)|packages\/(ui|i18n|rtc-browser))\/src\//.test(path);
  const feature = path.match(/^(apps\/[^/]+\/src)\/features\/([^/]+)\//);

  for (const specifier of importsOf(path, code)) {
    const workspaceEntry = specifier.match(/^@screen-share\/([^/]+)(\/.*)?$/);
    if (
      workspaceEntry?.[2] &&
      !publicExports.get(workspaceEntry[1] ?? '')?.has(`.${workspaceEntry[2]}`)
    ) {
      issues.push('Workspaces must be imported through public exports.');
    }

    if (browser && /^(node:|hono(?:\/|$)|pg$|drizzle-orm|livekit-server-sdk|bun$)/.test(specifier))
      issues.push('Browser cannot import server/runtime adapters.');

    const target = resolveSourceImport(path, specifier);
    if (path.includes('/domain/') && !target)
      issues.push('Domain must not import frameworks or runtime packages.');

    if (!target) continue;
    const originWorkspace = path.match(/^(apps|packages)\/[^/]+/)?.[0];
    const targetWorkspace = target.match(/^(apps|packages)\/[^/]+/)?.[0];
    if (originWorkspace && targetWorkspace && originWorkspace !== targetWorkspace)
      issues.push('Use package exports instead of cross-workspace relative imports.');

    if (browser && target.startsWith('apps/control-api/'))
      issues.push('Browser cannot import API internals.');
    if (browser && path.includes('/shared/') && /\/(features|app)\//.test(target))
      issues.push('Shared must not depend on app or features.');
    if (feature && target.startsWith(`${feature[1]}/app/`))
      issues.push('Feature must not depend on app composition.');

    const targetFeature = target.match(/^(apps\/[^/]+\/src)\/features\/([^/]+)(.*)$/);

    if (
      feature &&
      targetFeature &&
      feature[2] !== targetFeature[2] &&
      !['', '/index', '/index.ts'].includes(targetFeature[3] ?? '')
    )
      issues.push('Cross-feature imports must use the public index.');

    if (path.includes('/domain/') && !target.includes('/domain/'))
      issues.push('Domain dependencies must point inward.');
    if (path.includes('/application/') && /\/(adapters|runtime|app)\//.test(target))
      issues.push('Application must depend on ports, not adapters.');
  }

  return issues;
}

export function findCycles(sources: Map<string, string>): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const issues: string[] = [];

  function visit(file: string) {
    if (visiting.has(file)) {
      issues.push(`Import cycle: ${file}`);

      return;
    }
    if (visited.has(file)) return;

    visiting.add(file);

    for (const specifier of importsOf(file, sources.get(file) ?? '')) {
      const resolved = resolveSourceImport(file, specifier);
      if (!resolved) continue;
      const base = resolved.replace(/\.js$/, '');
      const target = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ].find((candidate) => sources.has(candidate));

      if (target) visit(target);
    }

    visiting.delete(file);
    visited.add(file);
  }

  for (const file of sources.keys()) visit(file);

  return issues;
}

export function normalizedPath(root: string, file: string) {
  return relative(root, file).replaceAll('\\', '/');
}
