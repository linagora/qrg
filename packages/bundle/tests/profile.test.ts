/**
 * Real composition of the `qrg` profile: the installation procedure of the
 * README creates it in a temporary DSH home, and the published dsh
 * 0.2.1-alpha.4 boots it with a probe row that reports what it mounted. The
 * cuts live twice, in a bundle patch and in the profile's own patch layer,
 * and each copy holds alone: when dsh skips the bundle, and when the profile
 * patch layer is emptied.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROFILE_PATCH_FILENAME } from '@deepseek-ai/dsh-app-boot'
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest'
import { BUNDLE_DIR } from '../src/profile.ts'
import { LAUNCH_TEST_TIMEOUT_MS, TELEMETRY_SWITCH_UNSET, probeProfile } from './fixtures/launch.ts'
import type { LaunchOptions, ProbedLaunch } from './fixtures/launch.ts'
import { FIBER_ACTIVE } from './fixtures/probe.ts'

/** The dsh-base permission rows select full access from this variable. */
const FULL_ACCESS_ASKED = { ...TELEMETRY_SWITCH_UNSET, DSH_PERMISSION_MODE: 'danger-full-access' }

/** Plugins that send data to DeepSeek or act on its account: none may be active. */
const DEEPSEEK_FLOWS = [
  '@deepseek-ai/dsh-session-telemetry-otel',
  '@deepseek-ai/dsh-session-log-deepseek',
  '@deepseek-ai/dsh-plugin-package-inventory-deepseek',
  '@deepseek-ai/dsh-llm-deepseek-api-key',
  '@deepseek-ai/dsh-llm-deepseek-account',
  '@deepseek-ai/dsh-web-search-deepseek',
  '@deepseek-ai/dsh-deepseek-account-platform',
  '@deepseek-ai/dsh-api-account-controller',
  '@deepseek-ai/dsh-host-product-telemetry-otel',
]

/** Modules of the DSH `delegation` group, which `route_and_delegate` replaces. */
const DELEGATION_MODULES = [
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-subagent-control',
  '@deepseek-ai/dsh-tool-subagent-control/list-agents',
  '@deepseek-ai/dsh-workflow-ptc',
  '@deepseek-ai/dsh-tool-workflow',
]

const TOOLS_ROW = { entryId: 'qrg-router-tools', moduleName: '@linagora/qrg-router/tools', enabled: true, fiberState: FIBER_ACTIVE }

/**
 * Boot the installed profile once with the probe for the tests of the
 * enclosing describe, with DSH_PERMISSION_MODE asking for full access.
 * @param options - the name of the launch and the change to the profile.
 * @returns the launch, once beforeAll has run.
 */
function probeOnce(options: Pick<LaunchOptions, 'label' | 'prepareProfile'>): () => ProbedLaunch {
  let cwd: string | undefined
  let launch: ProbedLaunch | undefined
  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'qrg-profile-'))
    launch = await probeProfile({ ...options, cwd, overlay: [], env: FULL_ACCESS_ASKED })
  }, LAUNCH_TEST_TIMEOUT_MS)
  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true })
  })
  return () => {
    assert(launch !== undefined, `${options.label}: no launch`)
    return launch
  }
}

/**
 * The cuts each copy of the profile rows makes alone.
 * @param launch - the probed launch.
 */
function itCutsTheFlowsToDeepSeek(launch: () => ProbedLaunch): void {
  it('mounts none of the plugins that send data to DeepSeek', () => {
    const active = launch().report.activeRows.map(row => row.name)
    expect(active.filter(name => DEEPSEEK_FLOWS.includes(name))).toEqual([])
  })

  it('runs the lead model on the gateway route, the only route registered', () => {
    const { providers, defaultModel } = launch().report
    expect(providers).toEqual(['linagora'])
    expect(defaultModel).toEqual({ provider: 'linagora', model: 'qwen3.8' })
  })

  it('disables the fork provider', () => {
    const active = launch().report.activeRows.map(row => row.name)
    expect(active).not.toContain('@deepseek-ai/dsh-subagent-fork-in-process')
  })

  it('gives no danger-full-access, though DSH_PERMISSION_MODE asks for it', () => {
    expect(launch().report.permission).toEqual({
      presets: ['read-only', 'workspace-write'],
      defaultPreset: 'workspace-write',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'ask',
    })
  })
}

/**
 * The agent presets the profile rows leave when the bundle is loaded.
 * @param launch - the probed launch.
 */
function itReplacesTheDelegationGroup(launch: () => ProbedLaunch): void {
  it('replaces the delegation group with route_and_delegate in standard and ptc, and drops cordis', () => {
    const { agentPresets } = launch().report
    expect(agentPresets.map(preset => preset.id).sort()).toEqual(['minimal', 'ptc', 'standard'])
    for (const presetId of ['standard', 'ptc']) {
      const rows = agentPresets.find(preset => preset.id === presetId)?.rows ?? []
      expect(rows, presetId).toContainEqual(TOOLS_ROW)
      expect(rows.filter(row => DELEGATION_MODULES.includes(row.moduleName)), presetId).toEqual([])
    }
  })
}

/**
 * Put a copy of the bundle in the profile in place of its link, with a dsh
 * requirement the running dsh does not meet: dsh then skips it without
 * error, as after a DSH update the bundle does not follow yet.
 * @param profileDir - the installed profile.
 */
async function installOutOfRangeBundle(profileDir: string): Promise<void> {
  const copy = join(profileDir, 'node_modules', '@linagora', 'qrg-bundle')
  await rm(copy)
  await mkdir(copy)
  const manifest = JSON.parse(await readFile(join(BUNDLE_DIR, 'package.json'), 'utf8')) as object
  // A version of its own, which the canary exemption, keyed on name@version, does not cover.
  await writeFile(join(copy, 'package.json'), JSON.stringify({ ...manifest, version: '0.0.0-out-of-range', engines: { dsh: '0.0.1' } }))
  for (const patch of ['cordis.patch.yml', 'profile.patch.yml']) await copyFile(join(BUNDLE_DIR, patch), join(copy, patch))
}

/**
 * Empty the profile's own patch layer, which DSH's settings editor rewrites.
 * @param profileDir - the installed profile.
 */
async function emptyProfilePatch(profileDir: string): Promise<void> {
  await writeFile(join(profileDir, PROFILE_PATCH_FILENAME), '[]\n')
}

describe('the qrg profile', () => {
  const launch = probeOnce({ label: 'QRG profile' })

  it('boots without a warning', () => {
    expect(launch().stderr).toBe('')
  })

  itCutsTheFlowsToDeepSeek(launch)
  itReplacesTheDelegationGroup(launch)
})

describe('the qrg profile when dsh skips the QRG bundle', () => {
  const launch = probeOnce({ label: 'QRG profile, bundle skipped', prepareProfile: installOutOfRangeBundle })

  it('skips the bundle, so no qrg-router row is mounted', () => {
    expect(launch().stderr).toContain('dsh: skipping profile bundle "@linagora/qrg-bundle"')
    expect(launch().report.hostRows).toEqual([])
  })

  itCutsTheFlowsToDeepSeek(launch)

  it('breaks standard and ptc rather than give the delegation group back, and drops cordis', () => {
    const { agentPresets } = launch().report
    expect(agentPresets.map(preset => preset.id).sort()).toEqual(['minimal', 'ptc', 'standard'])
    for (const presetId of ['standard', 'ptc']) {
      const preset = agentPresets.find(candidate => candidate.id === presetId)
      expect(preset?.broken, presetId).toMatch(/^qrg-router-tools \(@linagora\/qrg-router\/tools\): /)
      expect(preset?.rows.filter(row => DELEGATION_MODULES.includes(row.moduleName)), presetId).toEqual([])
    }
  })
})

describe('the qrg profile with its own patch layer emptied', () => {
  const launch = probeOnce({ label: 'QRG profile, profile patch emptied', prepareProfile: emptyProfilePatch })

  it('boots without a warning', () => {
    expect(launch().stderr).toBe('')
  })

  itCutsTheFlowsToDeepSeek(launch)
  itReplacesTheDelegationGroup(launch)
})
