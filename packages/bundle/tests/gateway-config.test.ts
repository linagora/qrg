/**
 * The LINAGORA AI Gateway is a route of DSH's pi-ai adapter, named by the
 * reference of its key: the bundle carries no secret. Address, protocol and
 * model come from notes/acces-lot1.md. The routing policy of the profile
 * sends every task there unless the user forces another couple, and keeps
 * C2 and C3 tasks there whatever the user forces.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'
import { decide, parsePolicy } from '../../router/src/policy.ts'
import { POLICY_FILENAME } from '../src/profile.ts'

const BIN_NAME = 'qrg-gateway-config-test'
const bundlePatches = loadOverlayPatches(BIN_NAME, fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
const profilePatches = loadOverlayPatches(BIN_NAME, fileURLToPath(new URL('../profile.patch.yml', import.meta.url)))

describe('QRG gateway configuration', () => {
  it('declares the linagora route with the reference of its key only', () => {
    expect(profilePatches.find(patch => patch.id === 'llm-pi-ai')).toEqual({
      id: 'llm-pi-ai',
      config: {
        providers: {
          linagora: {
            apiKeyEnv: 'LINAGORA_API_KEY',
            api: 'openai-completions',
            baseURL: 'https://ai-api.linagora.com/v1',
            models: [{ id: 'qwen3.8' }],
          },
        },
      },
    })
  })

  it('delegates through that route, by the policy the installer copies into the profile', () => {
    const host = bundlePatches.flatMap(patch => patch.insert ?? []).find(row => row.id === 'qrg-router')
    expect(host?.config).toEqual({ gateway: 'linagora', policy: POLICY_FILENAME })
  })

  it.each(['C0', 'C1', 'C2', 'C3'] as const)('sends a %s task to qwen3.8 by the default policy', async sensitivity => {
    const policy = parsePolicy(await readFile(new URL('../policy.yml', import.meta.url), 'utf8'))
    expect(decide(policy, { intent: 'refactor', interactive: false, sensitivity })).toMatchObject({ couple: { agent: 'native', model: 'qwen3.8' } })
  })

  it.each(['C0', 'C1'] as const)('lets the user force Claude Code on a %s task by the default policy', async sensitivity => {
    const policy = parsePolicy(await readFile(new URL('../policy.yml', import.meta.url), 'utf8'))
    expect(decide(policy, { intent: 'refactor', interactive: false, sensitivity, forced: 'claude' })).toMatchObject({
      couple: { id: 'claude-code/claude-opus', agent: 'claude-code' },
      decidedBy: 'forced',
    })
  })

  it.each(['C2', 'C3'] as const)('keeps a %s task on the gateway when the user forces Claude Code, by the default policy', async sensitivity => {
    const policy = parsePolicy(await readFile(new URL('../policy.yml', import.meta.url), 'utf8'))
    expect(decide(policy, { intent: 'refactor', interactive: false, sensitivity, forced: 'claude' })).toEqual({
      refused: `@claude is refused: claude-code/claude-opus does not admit ${sensitivity}`,
      forced: 'claude',
      options: ['native/qwen3.8'],
      allowRules: ['sensitive-stays-internal'],
    })
  })
})
