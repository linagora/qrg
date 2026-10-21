/**
 * The host row reads a relative policy path from the profile directory,
 * which only a profile launched by dsh gives, never from the directory dsh
 * was started from. The delegation test of the bundle reads one in a profile.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('qrg-router policy path', () => {
  it('refuses a relative path outside a dsh profile', async () => {
    await expect(apply(new Context(), { gateway: 'linagora', policy: 'qrg-policy.yml' }))
      .rejects.toThrow('qrg-router: the policy path qrg-policy.yml is relative, and no dsh profile gives its directory')
  })
})
