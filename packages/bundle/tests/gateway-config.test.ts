/**
 * The LINAGORA AI Gateway is a route of DSH's pi-ai adapter, named by the
 * reference of its key: the bundle carries no secret. Address, protocol and
 * model come from notes/acces-lot1.md.
 */
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'

const patches = loadOverlayPatches('qrg-gateway-config-test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))

describe('QRG gateway configuration', () => {
  it('declares the linagora route with the reference of its key only', () => {
    expect(patches.find(patch => patch.id === 'llm-pi-ai')).toEqual({
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
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

  it('delegates through that route to qwen3.8 by default', () => {
    const host = patches.flatMap(patch => patch.insert ?? []).find(row => row.id === 'qrg-router')
    expect(host?.config).toEqual({ gateway: 'linagora', fallbackModel: 'qwen3.8' })
  })
})
