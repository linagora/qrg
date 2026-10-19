/**
 * Prepares the DSH canary job (.github/workflows/dsh-canary.yml) on the CI
 * checkout, before `pnpm install`. It selects the most recently published
 * @deepseek-ai/dsh version, alpha, release candidate or release, that has
 * passed pnpm's release-age gate, and appends to pnpm-workspace.yaml the
 * overrides that install it in place of the pinned version: every
 * @deepseek-ai/dsh* dependency moves to that version, every other
 * @deepseek-ai dependency to the range it declares. The package.json pins
 * stay untouched, and the install keeps the workspace's strict release-age
 * mode, which fails on a package younger than the gate instead of exempting
 * it.
 *
 * Run with `node scripts/dsh-canary.ts`. It writes `version` to
 * $GITHUB_OUTPUT, empty when no version at least as recent as the pin has
 * passed the gate, and a report to $GITHUB_STEP_SUMMARY.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDshPackage, pinnedDshVersion, readWorkspace, ROOT, workspaceDependencies } from './workspace.ts'

const DSH = '@deepseek-ai/dsh'
/** pnpm 11's built-in minimumReleaseAge (1440 minutes); `packageManager` pins pnpm. */
const RELEASE_AGE_MS = 24 * 60 * 60 * 1000
/** A published version; the registry `time` field also holds `created` and `modified`. */
const PUBLISHED_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * Pick the dsh version to replay the suite against.
 * @param published - the registry `time` field of @deepseek-ai/dsh: version to ISO publish date.
 * @param pinned - the pinned dsh version.
 * @param now - current time in milliseconds.
 * @returns the most recently published version past the release-age gate,
 *   alpha, release candidate or release, or undefined when that version was
 *   published before the pin.
 */
export function selectVersion(published: Record<string, string>, pinned: string, now: number): string | undefined {
  const pinnedAt = published[pinned]
  if (pinnedAt === undefined) throw new Error(`the registry lists no ${DSH}@${pinned}`)
  const [newest] = Object.entries(published)
    .filter(([version, at]) => PUBLISHED_VERSION.test(version) && Date.parse(at) <= now - RELEASE_AGE_MS)
    .sort(([, a], [, b]) => Date.parse(b) - Date.parse(a))
  return newest !== undefined && Date.parse(newest[1]) >= Date.parse(pinnedAt) ? newest[0] : undefined
}

/**
 * Compute the pnpm overrides that replace the pinned DSH with another version.
 * @param dependencyNames - every dependency name of the workspace manifests.
 * @param version - the dsh version to install.
 * @param declared - the `dependencies` of @deepseek-ai/dsh at that version.
 * @returns overrides for the @deepseek-ai dependencies, sorted by name.
 */
export function canaryOverrides(dependencyNames: Iterable<string>, version: string, declared: Record<string, string>): Record<string, string> {
  const names = [...new Set(dependencyNames)].filter(name => name.startsWith('@deepseek-ai/')).sort()
  return Object.fromEntries(names.map(name => {
    if (isDshPackage(name)) return [name, version]
    const range = declared[name]
    if (range === undefined) throw new Error(`${DSH}@${version} declares no range for ${name}`)
    return [name, range]
  }))
}

/**
 * Render the settings appended to pnpm-workspace.yaml.
 * @param version - the dsh version to install.
 * @param overrides - from {@link canaryOverrides}.
 * @returns YAML text starting and ending with a newline.
 */
export function workspaceSettings(version: string, overrides: Record<string, string>): string {
  return [
    '',
    `# DSH canary (CI copy only): replay against ${DSH}@${version}.`,
    'overrides:',
    ...Object.entries(overrides).map(([name, override]) => `  '${name}': '${override}'`),
    '',
  ].join('\n')
}

function pnpmView(spec: string, field: string): Record<string, string> {
  return JSON.parse(execFileSync('pnpm', ['view', spec, field, '--json'], { encoding: 'utf8' })) as Record<string, string>
}

function report(version: string, summary: string): void {
  console.log(summary)
  const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env
  if (GITHUB_OUTPUT !== undefined) appendFileSync(GITHUB_OUTPUT, `version=${version}\n`)
  if (GITHUB_STEP_SUMMARY !== undefined) appendFileSync(GITHUB_STEP_SUMMARY, `${summary}\n`)
}

function main(): void {
  const workspace = readWorkspace()
  const pinned = pinnedDshVersion(workspace.packages)
  if (pinned === undefined) throw new Error('@linagora/qrg-bundle declares no engines.dsh')
  const version = selectVersion(pnpmView(DSH, 'time'), pinned, Date.now())
  if (version === undefined) {
    report('', `No ${DSH} version at least as recent as the pin ${pinned} has passed pnpm's 24-hour release-age gate: nothing to replay.`)
    return
  }
  const names = workspaceDependencies(workspace).map(dependency => dependency.name)
  const overrides = canaryOverrides(names, version, pnpmView(`${DSH}@${version}`, 'dependencies'))
  const workspaceFile = join(ROOT, 'pnpm-workspace.yaml')
  if (/^overrides:/m.test(readFileSync(workspaceFile, 'utf8'))) {
    throw new Error('pnpm-workspace.yaml already sets overrides: merge them with the canary ones in scripts/dsh-canary.ts')
  }
  appendFileSync(workspaceFile, workspaceSettings(version, overrides))
  report(version, [
    `Replaying pnpm check against ${DSH}@${version} (pin: ${pinned}).`,
    '',
    '| Package | Override |',
    '| --- | --- |',
    ...Object.entries(overrides).map(([name, override]) => `| ${name} | ${override} |`),
  ].join('\n'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
