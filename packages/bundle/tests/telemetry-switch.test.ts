/**
 * Review of S-06: what DSH_TELEMETRY_DISABLED covers. Set, it makes dsh
 * disable the telemetry row after every patch layer; the `pnpm qrg`
 * launcher sets it. The test overlay, the last layer, plays a user layer
 * that turns telemetry back on.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAUNCH_TEST_TIMEOUT_MS, TELEMETRY_SWITCH_UNSET, probeProfile } from './fixtures/launch.ts'
import type { LaunchOptions } from './fixtures/launch.ts'

const TELEMETRY_MODULE = '@deepseek-ai/dsh-session-telemetry-otel'

/** The config of the dsh-base telemetry row, its exporter aimed at a closed local port. */
const TELEMETRY_CONFIG = {
  mode: 'FEEDBACK_ONLY',
  shutdownTimeoutMillis: 3000,
  maxRequestBytes: 4000000,
  exporter: { url: 'http://127.0.0.1:9/v1/logs', compression: 'gzip', timeoutMillis: 1000 },
  processor: { scheduledDelayMillis: 10000, maxQueueSize: 2048, maxExportBatchSize: 2048, exportTimeoutMillis: 1500 },
}

/**
 * Boot the profile once, DSH_TELEMETRY_DISABLED unset in the caller's
 * environment.
 * @param options - the name of the launch, its overlay, and whether it goes through the launcher.
 * @returns the active rows of the telemetry plugin.
 */
async function activeTelemetryRows(options: Pick<LaunchOptions, 'label' | 'overlay' | 'throughLauncher'>): Promise<{ id: string, name: string }[]> {
  const cwd = await mkdtemp(join(tmpdir(), 'qrg-telemetry-'))
  try {
    const { report } = await probeProfile({ ...options, cwd, env: TELEMETRY_SWITCH_UNSET })
    return report.activeRows.filter(row => row.name === TELEMETRY_MODULE)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

describe('DSH_TELEMETRY_DISABLED against a layer that turns telemetry back on (S-06)', () => {
  const reenable = [{ id: 'session-telemetry-otel', disabled: false }]

  it('lets the layer turn the telemetry row back on without the launcher', async () => {
    expect(await activeTelemetryRows({ label: 'telemetry turned back on', overlay: reenable }))
      .toEqual([{ id: 'session-telemetry-otel', name: TELEMETRY_MODULE }])
  }, LAUNCH_TEST_TIMEOUT_MS)

  it('disables the row after every layer through the launcher', async () => {
    expect(await activeTelemetryRows({ label: 'telemetry turned back on, launcher', overlay: reenable, throughLauncher: true }))
      .toEqual([])
  }, LAUNCH_TEST_TIMEOUT_MS)

  it('misses the telemetry plugin inserted under another id, even through the launcher', async () => {
    const reinsert = [{ insert: [{ id: 'qrg-telemetry-escape', name: TELEMETRY_MODULE, config: TELEMETRY_CONFIG }] }]
    expect(await activeTelemetryRows({ label: 'telemetry inserted again, launcher', overlay: reinsert, throughLauncher: true }))
      .toEqual([{ id: 'qrg-telemetry-escape', name: TELEMETRY_MODULE }])
  }, LAUNCH_TEST_TIMEOUT_MS)
})
