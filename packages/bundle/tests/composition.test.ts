/**
 * Real composition: the published dsh 0.2.1-alpha.4 launcher boots a profile
 * built from the shipped `web` template plus the QRG bundle, and a test
 * overlay inserts a probe row that reports the composition once startup
 * succeeds.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FiberState } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LAUNCH_TEST_TIMEOUT_MS, launchQrgProfile } from './fixtures/launch.ts'

/** cordis declares FiberState as a const enum, erased at runtime; the annotation checks the value. */
const FIBER_ACTIVE: FiberState.ACTIVE = 2

const probePath = fileURLToPath(new URL('fixtures/probe.ts', import.meta.url))

interface ProbeReport {
  hostRows: { id: string, name: string, fiberState?: FiberState }[]
  presets: {
    id: string
    broken?: string
    rows: { entryId: string | null, moduleName: string, enabled: boolean | 'conditional', fiberState?: FiberState }[]
  }[]
}

describe('QRG bundle composition', () => {
  it('activates the qrg-router host row and its tools row in the standard and ptc presets', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qrg-composition-'))
    try {
      const output = join(cwd, 'probe.json')
      const { stderr } = await launchQrgProfile({
        label: 'QRG bundle composition',
        cwd,
        overlay: [{ insert: [{ id: 'qrg-composition-probe', name: probePath, config: { output } }] }],
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
  }, LAUNCH_TEST_TIMEOUT_MS)
})
