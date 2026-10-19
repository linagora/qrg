/**
 * Workspace package.json reading for the DSH pin rules: which dependencies
 * are DSH packages, and where the pinned version lives.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** package.json fields that name dependencies. */
export const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

/** The package.json fields the DSH pin rules read. */
export type Manifest = { name: string, engines?: Record<string, string> }
  & Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>>

/** The root manifest and the workspace package manifests. */
export interface Workspace {
  root: Manifest
  packages: Manifest[]
}

/** A dependency as one workspace manifest declares it. */
export interface Dependency {
  package: string
  field: (typeof DEPENDENCY_FIELDS)[number]
  name: string
  version: string
}

/** Absolute path of the repository root. */
export const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Package whose `engines.dsh` holds the version the whole workspace is pinned on. */
const PIN_HOLDER = '@linagora/qrg-bundle'

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest
}

/**
 * Read the root package.json and those of `packages/*`, skipping the entries
 * that hold none, as pnpm's workspace glob does.
 * @returns the root manifest and the workspace package manifests.
 */
export function readWorkspace(): Workspace {
  const packagesDir = join(ROOT, 'packages')
  return {
    root: readManifest(ROOT),
    packages: readdirSync(packagesDir)
      .map(entry => join(packagesDir, entry))
      .filter(dir => existsSync(join(dir, 'package.json')))
      .map(dir => readManifest(dir)),
  }
}

/**
 * List the dependencies of the root and workspace package manifests.
 * @param workspace - from {@link readWorkspace}.
 * @returns one entry per manifest, dependency field and dependency.
 */
export function workspaceDependencies(workspace: Workspace): Dependency[] {
  return [workspace.root, ...workspace.packages].flatMap(pkg => DEPENDENCY_FIELDS.flatMap(field =>
    Object.entries(pkg[field] ?? {}).map(([name, version]) => ({ package: pkg.name, field, name, version }))))
}

/**
 * Tell whether a dependency is the dsh launcher or one of its packages.
 * @param name - npm package name.
 * @returns true for `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*`.
 */
export function isDshPackage(name: string): boolean {
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
}

/**
 * Find the pinned DSH version.
 * @param packages - workspace package manifests.
 * @returns the bundle's `engines.dsh`, or undefined when it declares none.
 */
export function pinnedDshVersion(packages: Manifest[]): string | undefined {
  return packages.find(pkg => pkg.name === PIN_HOLDER)?.engines?.['dsh']
}
