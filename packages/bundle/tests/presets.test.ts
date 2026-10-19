/**
 * A bundle patch cannot insert a row into an agent preset's `config.plugins`,
 * so cordis.patch.yml replaces the whole config of the standard and ptc
 * preset rows with copies of the presets dsh-web-app ships, plus the
 * qrg-router tools row right after the `delegation` group. These tests compare
 * the copies with the installed dsh-web-app: a DSH bump that changes either
 * preset fails here until the copy is redone.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { assert, describe, expect, it } from 'vitest'

const BIN_NAME = 'qrg-presets-test'
const TOOLS_ROW = { id: 'qrg-router-tools', name: '@linagora/qrg-router/tools' }

const require = createRequire(import.meta.url)
const bundlePatches = loadOverlayPatches(BIN_NAME, fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))

describe('QRG copies of the DSH agent presets', () => {
  it.each(['standard', 'ptc'])('match the shipped %s preset with the tools row after delegation', presetId => {
    const shipped = loadOverlayPatches(BIN_NAME, require.resolve(`@deepseek-ai/dsh-web-app/presets/${presetId}.patch.yml`))
    expect(shipped, `shape of the shipped ${presetId} preset file`).toEqual([{
      insert: [{ id: `preset-${presetId}`, name: '@deepseek-ai/dsh-agent-preset', config: expect.any(Object) }],
    }])
    const row = shipped[0]?.insert?.[0]
    assert(row !== undefined)
    const plugins: { id: string }[] = [...row.config.plugins]
    const delegation = plugins.findIndex(plugin => plugin.id === 'delegation')
    expect(delegation, `delegation group of the shipped ${presetId} preset`).toBeGreaterThanOrEqual(0)
    plugins.splice(delegation + 1, 0, TOOLS_ROW)

    expect(bundlePatches.find(patch => patch.id === row.id)).toEqual({
      id: row.id,
      name: row.name,
      config: { ...row.config, plugins },
    })
  })
})
