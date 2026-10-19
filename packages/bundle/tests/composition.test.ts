/**
 * Real composition: the published dsh 0.2.1-alpha.4 launcher boots a profile
 * built from the shipped `web` template plus the QRG bundle, and a test
 * overlay inserts a probe row that reports the composition once startup
 * succeeds. The bundle goes through dsh's own bundle loading, `engines.dsh`
 * check included, through a profile `node_modules` link to this package.
 */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FiberState } from '@deepseek-ai/cordis'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const PROFILE = 'qrg-composition'
const PROCESS_TIMEOUT_MS = 90_000
const TEST_TIMEOUT_MS = PROCESS_TIMEOUT_MS + 15_000
/** cordis declares FiberState as a const enum, erased at runtime; the annotation checks the value. */
const FIBER_ACTIVE: FiberState.ACTIVE = 2

const require = createRequire(import.meta.url)
const dshBin = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')
const bundleDir = fileURLToPath(new URL('..', import.meta.url))
const probePath = fileURLToPath(new URL('fixtures/probe.ts', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface PackageManifest {
  name: string
}

interface ProbeReport {
  hostRows: { id: string, name: string, fiberState?: FiberState }[]
  presets: {
    id: string
    broken?: string
    rows: { entryId: string | null, moduleName: string, enabled: boolean | 'conditional', fiberState?: FiberState }[]
  }[]
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

describe('QRG bundle composition', () => {
  it('activates the qrg-router host row and its tools row in the standard and ptc presets', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qrg-composition-'))
    try {
      const output = join(cwd, 'probe.json')
      const overlay = join(cwd, 'probe.patch.yml')
      const profileDir = join(cwd, '.dsh', 'profiles', PROFILE)
      const bundle = await readManifest(join(bundleDir, 'package.json'))
      await writeProfile(profileDir, bundle)
      // JSON is valid YAML; the absolute probe path is anchored as a file URL.
      await writeFile(overlay, JSON.stringify([{
        insert: [{ id: 'qrg-composition-probe', name: probePath, config: { output } }],
      }]))
      const { stderr } = await runLoaderSmoke({
        label: 'QRG bundle composition',
        cwd,
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
        },
      })

      expect(stderr).toBe('')
      const report = JSON.parse(await readFile(output, 'utf8')) as ProbeReport
      expect(report.hostRows).toEqual([
        { id: 'qrg-router', name: '@linagora/qrg-router', fiberState: FIBER_ACTIVE },
      ])
      for (const presetId of ['standard', 'ptc']) {
        const preset = report.presets.find(candidate => candidate.id === presetId)
        expect(preset, presetId).toBeDefined()
        expect(preset?.broken, presetId).toBeUndefined()
        expect(preset?.rows, presetId).toContainEqual({
          entryId: 'qrg-router-tools',
          moduleName: '@linagora/qrg-router/tools',
          enabled: true,
          fiberState: FIBER_ACTIVE,
        })
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, TEST_TIMEOUT_MS)
})
