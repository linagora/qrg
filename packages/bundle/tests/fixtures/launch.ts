/**
 * Launch of the published dsh 0.2.1-alpha.4 for the composition tests, on
 * the `qrg` profile as the installation procedure creates it, in a DSH home
 * of the launch directory, with a test overlay as the last patch layer. The
 * bundle goes through dsh's own bundle loading, `engines.dsh` check
 * included, through the profile's `node_modules` link to this package.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { BUNDLE_DIR, DSH_BIN, PROFILE_NAME, installProfile } from '../../src/profile.ts'
import type { ProbeReport } from './probe.ts'

const PROCESS_TIMEOUT_MS = 90_000
/** Vitest deadline of a test that launches dsh once. */
export const LAUNCH_TEST_TIMEOUT_MS = PROCESS_TIMEOUT_MS + 15_000
/** Set by the DSH canary job to the newer dsh version it installed in place of the pinned one. */
const CANARY_VERSION_ENV = 'QRG_DSH_CANARY_VERSION'

/**
 * Without DSH_TELEMETRY_DISABLED, which the launches set by default: the
 * profile must cut telemetry by itself. Should it fail to, the exporter
 * would aim at a closed local port.
 */
export const TELEMETRY_SWITCH_UNSET = { DSH_TELEMETRY_DISABLED: undefined, DSH_TELEMETRY_OTLP_URL: 'http://127.0.0.1:9/v1/logs' }

const require = createRequire(import.meta.url)
const probePath = fileURLToPath(new URL('probe.ts', import.meta.url))
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
  /** Change the installed profile before dsh loads it. */
  prepareProfile?: (profileDir: string) => Promise<void>
}

/** What a launch with the probe row leaves. */
export interface ProbedLaunch {
  stderr: string
  report: ProbeReport
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
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
  const profileDir = await installProfile(join(options.cwd, '.dsh'))
  const canaryVersion = process.env[CANARY_VERSION_ENV]
  if (canaryVersion !== undefined && canaryVersion !== '') {
    await allowCanaryVersion(profileDir, await readManifest(join(BUNDLE_DIR, 'package.json')), canaryVersion)
  }
  await options.prepareProfile?.(profileDir)
  const overlay = join(options.cwd, 'test.patch.yml')
  // JSON is valid YAML; absolute plugin paths are anchored as file URLs.
  await writeFile(overlay, JSON.stringify(options.overlay))
  return runLoaderSmoke({
    label: options.label,
    cwd: options.cwd,
    mode: 'lib',
    binScript: DSH_BIN,
    libBinScript: DSH_BIN,
    configPath: overlay,
    binArgs: ['--profile', PROFILE_NAME, '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open'],
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

/**
 * Launch dsh on the QRG profile once with the probe row, which reports what
 * the composition mounted.
 * @param options - the launch; the probe row joins the end of its overlay.
 * @returns the output of dsh and the probe report.
 */
export async function probeProfile(options: LaunchOptions): Promise<ProbedLaunch> {
  const output = join(options.cwd, 'probe.json')
  const { stderr } = await launchQrgProfile({
    ...options,
    overlay: [...options.overlay, { insert: [{ id: 'qrg-composition-probe', name: probePath, config: { output } }] }],
  })
  return { stderr, report: JSON.parse(await readFile(output, 'utf8')) as ProbeReport }
}
