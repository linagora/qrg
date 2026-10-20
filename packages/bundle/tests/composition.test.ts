/**
 * Real composition: the published dsh 0.2.1-alpha.4 launcher boots a profile
 * built from the shipped `web` template plus the QRG bundle, and a test
 * overlay inserts a probe row that reports the composition once startup
 * succeeds.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAUNCH_TEST_TIMEOUT_MS, probeProfile } from './fixtures/launch.ts'
import { FIBER_ACTIVE } from './fixtures/probe.ts'

describe('QRG bundle composition', () => {
  it('activates the qrg-router host row and its tools row in the standard and ptc presets', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qrg-composition-'))
    try {
      const { stderr, report } = await probeProfile({ label: 'QRG bundle composition', cwd, overlay: [] })

      expect(stderr).toBe('')
      expect(report.hostRows).toEqual([
        { id: 'qrg-router', name: '@linagora/qrg-router', fiberState: FIBER_ACTIVE },
      ])
      for (const presetId of ['standard', 'ptc']) {
        const preset = report.agentPresets.find(candidate => candidate.id === presetId)
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
  }, LAUNCH_TEST_TIMEOUT_MS)
})
