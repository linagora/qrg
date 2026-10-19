/**
 * Launch of the published dsh 0.2.1-alpha.4 for the composition tests, on a
 * profile built from the shipped `web` template plus the QRG bundle, with a
 * test overlay as the last patch layer. The bundle goes through dsh's own
 * bundle loading, `engines.dsh` check included, through a profile
 * `node_modules` link to this package.
 */
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const PROFILE = 'qrg-test'
const PROCESS_TIMEOUT_MS = 90_000
/** Vitest deadline of a test that launches dsh once. */
export const LAUNCH_TEST_TIMEOUT_MS = PROCESS_TIMEOUT_MS + 15_000
/** Set by the DSH canary job to the newer dsh version it installed in place of the pinned one. */
const CANARY_VERSION_ENV = 'QRG_DSH_CANARY_VERSION'

const require = createRequire(import.meta.url)
const dshBin = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')
const bundleDir = fileURLToPath(new URL('../..', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface PackageManifest {
  name: string
  version: string
}

/** What a composition test launches. */
export interface LaunchOptions {
  /** Name of the launch in diagnostics. */
  label: string
  /** Directory dsh runs in; its `.dsh` subdirectory is DSH_HOME. */
  cwd: string
  /** Patches of the test overlay. */
  overlay: readonly object[]
  /** Environment variables to set, or to clear with `undefined`. */
  env?: Record<string, string | undefined>
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

/** Create the profile the way `dsh plugin add` leaves it from the shipped `web` template, with the bundle linked instead of installed. */
async function writeProfile(profileDir: string, bundle: PackageManifest): Promise<void> {
  const web = PROFILE_TEMPLATES['web']
  if (web === undefined) throw new Error('dsh ships no web profile template')
  await mkdir(join(profileDir, 'node_modules', dirname(bundle.name)), { recursive: true })
  await symlink(bundleDir, join(profileDir, 'node_modules', bundle.name), 'dir')
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${PROFILE}`,
    private: true,
    dependencies: { [bundle.name]: `link:${bundleDir}` },
    dsh: { profile: { bundles: [...web.bundles, bundle.name] } },
  }, undefined, 2))
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
}

/**
 * Grant the bundle and qrg-router the exact exemption `dsh plugin allow-version`
 * gives: the canary measures API compatibility, not the version gate it
 * already fails.
 */
async function allowCanaryVersion(profileDir: string, bundle: PackageManifest, canaryVersion: string): Promise<void> {
  const router = await readManifest(require.resolve('@linagora/qrg-router/package.json'))
  const exemptions = Object.fromEntries([bundle, router].map(pkg => [`${pkg.name}@${pkg.version}`, [canaryVersion]]))
  await writeFile(join(profileDir, 'compatibility.json'), JSON.stringify(exemptions, undefined, 2))
}

/**
 * Launch dsh on the QRG profile and wait for its exit.
 * @param options - where to run, the test overlay and the environment.
 * @returns the output of dsh, which exited with code 0.
 */
export async function launchQrgProfile(options: LaunchOptions): Promise<{ stdout: string, stderr: string }> {
  const profileDir = join(options.cwd, '.dsh', 'profiles', PROFILE)
  const bundle = await readManifest(join(bundleDir, 'package.json'))
  await writeProfile(profileDir, bundle)
  const canaryVersion = process.env[CANARY_VERSION_ENV]
  if (canaryVersion !== undefined && canaryVersion !== '') await allowCanaryVersion(profileDir, bundle, canaryVersion)
  const overlay = join(options.cwd, 'test.patch.yml')
  // JSON is valid YAML; absolute plugin paths are anchored as file URLs.
  await writeFile(overlay, JSON.stringify(options.overlay))
  return runLoaderSmoke({
    label: options.label,
    cwd: options.cwd,
    mode: 'lib',
    binScript: dshBin,
    libBinScript: dshBin,
    configPath: overlay,
    binArgs: ['--profile', PROFILE, '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open'],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: PROCESS_TIMEOUT_MS,
    env: {
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: undefined,
      DEEPSEEK_BASE_URL: undefined,
      ANTHROPIC_API_KEY: undefined,
      // The bundle's gateway route names this variable: a real key from the
      // developer's shell must never reach the launched dsh.
      LINAGORA_API_KEY: undefined,
      ...options.env,
    },
  })
}
