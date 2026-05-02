import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const packageDefinitions = [
  { path: '.', tagPrefix: 'yagr@', publishTarget: 'npm', publicTier: 'app', entrypoint: 'dist/index.js' },
  { path: 'packages/conversation-core', tagPrefix: '@yagr/conversation-core@', publishTarget: 'npm', publicTier: 'internal', entrypoint: 'dist/index.js' },
  { path: 'packages/conversation-service', tagPrefix: '@yagr/conversation-service@', publishTarget: 'npm', publicTier: 'optional', entrypoint: 'dist/index.js' },
  { path: 'packages/deepagent-bootstrap', tagPrefix: '@yagr/deepagent-bootstrap@', publishTarget: 'npm', publicTier: 'internal', entrypoint: 'dist/index.js' },
  { path: 'packages/gateway-core', tagPrefix: '@yagr/gateway-core@', publishTarget: 'npm', publicTier: 'internal', entrypoint: 'dist/index.js' },
  { path: 'packages/impact-ledger', tagPrefix: '@yagr/impact-ledger@', publishTarget: 'npm', publicTier: 'primary', entrypoint: 'dist/index.js' },
  { path: 'packages/plugin-runtime', tagPrefix: '@yagr/plugin-runtime@', publishTarget: 'npm', publicTier: 'primary', entrypoint: 'dist/index.js' },
  { path: 'packages/provider-runtime', tagPrefix: '@yagr/provider-runtime@', publishTarget: 'npm', publicTier: 'primary', entrypoint: 'dist/index.js' },
  { path: 'packages/reality-observer', tagPrefix: '@yagr/reality-observer@', publishTarget: 'npm', publicTier: 'primary', entrypoint: 'dist/index.js' },
  { path: 'packages/runtime', tagPrefix: '@yagr/runtime@', publishTarget: 'npm', publicTier: 'primary', entrypoint: 'dist/index.js' },
  { path: 'packages/runtime-events', tagPrefix: '@yagr/runtime-events@', publishTarget: 'npm', publicTier: 'primary', entrypoint: 'dist/index.js' },
  { path: 'packages/session-checkpoint', tagPrefix: '@yagr/session-checkpoint@', publishTarget: 'npm', publicTier: 'internal', entrypoint: 'dist/index.js' },
  { path: 'packages/session-memory', tagPrefix: '@yagr/session-memory@', publishTarget: 'npm', publicTier: 'internal', entrypoint: 'dist/index.js' },
  { path: 'packages/session-service', tagPrefix: '@yagr/session-service@', publishTarget: 'npm', publicTier: 'optional', entrypoint: 'dist/index.js' },
  { path: 'packages/stream-adapter', tagPrefix: '@yagr/stream-adapter@', publishTarget: 'npm', publicTier: 'optional', entrypoint: 'dist/index.js' },
  { path: 'packages/surfaces', tagPrefix: '@yagr/surfaces@', publishTarget: 'npm', publicTier: 'optional', entrypoint: 'dist/index.js' },
  { path: 'packages/tui-surface', tagPrefix: '@yagr/tui-surface@', publishTarget: 'npm', publicTier: 'internal', entrypoint: 'dist/index.js' },
  { path: 'packages/webui-session-registry', tagPrefix: '@yagr/webui-session-registry@', publishTarget: 'npm', publicTier: 'internal', entrypoint: 'dist/index.js' },
  { path: 'packages/webui-surface', tagPrefix: '@yagr/webui-surface@', publishTarget: 'npm', publicTier: 'internal', entrypoint: 'dist/index.js' },
];

export const dependencyFields = ['dependencies', 'peerDependencies', 'optionalDependencies'];

export function packageJsonPath(definition) {
  return path.join(definition.path, 'package.json');
}

export function absolutePackagePath(definition) {
  return path.join(workspaceRoot, definition.path);
}

export function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8'));
}

export function writeJson(relativePath, value) {
  const absolutePath = path.join(workspaceRoot, relativePath);
  const existing = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (existing !== next) {
    fs.writeFileSync(absolutePath, next);
  }
}

export function loadWorkspacePackages() {
  const packages = packageDefinitions.map(definition => {
    const manifestPath = packageJsonPath(definition);
    const manifest = readJson(manifestPath);
    return {
      ...definition,
      name: manifest.name,
      version: manifest.version,
      packageJsonPath: manifestPath,
      absolutePath: absolutePackagePath(definition),
      manifest,
    };
  });

  validatePackageSet(packages);
  return packages;
}

export function getInternalPackageMap(packages = loadWorkspacePackages()) {
  return new Map(packages.map(pkg => [pkg.name, pkg]));
}

export function getInternalDependencies(manifest, internalNames) {
  const dependencies = new Set();
  for (const field of dependencyFields) {
    for (const name of Object.keys(manifest[field] || {})) {
      if (internalNames.has(name)) {
        dependencies.add(name);
      }
    }
  }
  return [...dependencies].sort();
}

export function getPackageGraph(packages = loadWorkspacePackages()) {
  const internalNames = new Set(packages.map(pkg => pkg.name));
  return packages.map(pkg => ({
    ...pkg,
    internalDependencies: getInternalDependencies(pkg.manifest, internalNames),
  }));
}

export function topologicalPackages(packages = getPackageGraph()) {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]));
  const temporary = new Set();
  const permanent = new Set();
  const sorted = [];

  function visit(pkg, stack) {
    if (permanent.has(pkg.name)) return;
    if (temporary.has(pkg.name)) {
      throw new Error(`Workspace dependency cycle detected: ${[...stack, pkg.name].join(' -> ')}`);
    }

    temporary.add(pkg.name);
    for (const dependencyName of pkg.internalDependencies) {
      const dependency = byName.get(dependencyName);
      if (!dependency) {
        throw new Error(`${pkg.name} references unknown internal dependency ${dependencyName}`);
      }
      visit(dependency, [...stack, pkg.name]);
    }
    temporary.delete(pkg.name);
    permanent.add(pkg.name);
    sorted.push(pkg);
  }

  for (const pkg of packages) {
    visit(pkg, []);
  }

  return sorted;
}

export function expectedLocalDependencySpec(fromPkg, toPkg) {
  const relative = path.relative(fromPkg.absolutePath, toPkg.absolutePath).replaceAll(path.sep, '/');
  return `file:${relative}`;
}

export function getPackageSourceDirs(pkg) {
  const dirs = [];
  for (const dir of ['src', 'dist']) {
    const absolute = path.join(pkg.absolutePath, dir);
    if (fs.existsSync(absolute)) dirs.push(absolute);
  }
  return dirs;
}

export function listFilesRecursive(dir, predicate = () => true) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...listFilesRecursive(absolute, predicate));
    } else if (predicate(absolute)) {
      files.push(absolute);
    }
  }
  return files;
}

export function detectInternalImports(pkg, internalNames) {
  const imports = new Set();
  const importPattern = /(?:from\s+['"]|import\s*\(\s*['"]|export\s+[^'";]*\s+from\s+['"])(@yagr\/[^'"/]+)(?:['"]|\/)/g;
  const bareImportPattern = /import\s+['"](@yagr\/[^'"/]+)(?:['"]|\/)/g;
  const files = getPackageSourceDirs(pkg).flatMap(dir => listFilesRecursive(
    dir,
    file => /\.(ts|tsx|js|jsx|d\.ts)$/.test(file) && !/\.test\.(ts|tsx|js|jsx)$/.test(file),
  ));

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of [importPattern, bareImportPattern]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content))) {
        const name = match[1];
        if (internalNames.has(name) && name !== pkg.name) {
          imports.add(name);
        }
      }
    }
  }

  return [...imports].sort();
}

export function sortObjectKeys(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function validatePackageSet(packages) {
  const names = new Set();
  for (const pkg of packages) {
    if (!pkg.name) throw new Error(`Missing package name in ${pkg.packageJsonPath}`);
    if (names.has(pkg.name)) throw new Error(`Duplicate workspace package name: ${pkg.name}`);
    names.add(pkg.name);
    if (!fs.existsSync(pkg.absolutePath)) throw new Error(`Missing package directory for ${pkg.name}: ${pkg.path}`);
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}
