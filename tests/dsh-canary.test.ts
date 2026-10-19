/**
 * Selection and overrides of the DSH canary script. Publish times mirror the
 * registry: 0.2.1-alpha.4 came out on 2026-10-15 at 13:08 UTC, and DSH moved
 * from alphas to release candidates on 2026-10-17. Each version passes pnpm's
 * 24-hour release-age gate a day after its publication.
 */
import { describe, expect, it } from 'vitest'
import { canaryOverrides, selectVersion, workspaceSettings } from '../scripts/dsh-canary.ts'

const PUBLISHED = {
  'created': '2026-08-10T19:41:11.384Z',
  'modified': '2026-10-19T06:29:58.393Z',
  '0.2.0-rc.2': '2026-09-29T09:56:27.792Z',
  '0.2.1-alpha.3': '2026-10-14T12:35:33.988Z',
  '0.2.1-alpha.4': '2026-10-15T13:08:08.555Z',
  '0.2.1-alpha.5': '2026-10-16T12:31:49.659Z',
  '0.2.1-rc.1': '2026-10-17T03:17:24.154Z',
  '0.2.1-rc.2': '2026-10-17T08:36:31.655Z',
}

describe('DSH canary version selection', () => {
  it('takes the newest version past the release-age gate, release candidates included', () => {
    expect(selectVersion(PUBLISHED, '0.2.1-alpha.4', Date.parse('2026-10-20T12:00:00Z'))).toBe('0.2.1-rc.2')
  })

  it('leaves a newer version out until it passes the gate', () => {
    expect(selectVersion(PUBLISHED, '0.2.1-alpha.4', Date.parse('2026-10-18T06:00:00Z'))).toBe('0.2.1-rc.1')
  })

  it('takes a release past the gate', () => {
    // 0.2.1 is not out yet: a hypothetical publication.
    const published = { ...PUBLISHED, '0.2.1': '2026-10-21T10:00:00.000Z' }
    expect(selectVersion(published, '0.2.1-alpha.4', Date.parse('2026-10-22T12:00:00Z'))).toBe('0.2.1')
  })

  it('replays nothing while every version past the gate is older than the pin', () => {
    expect(selectVersion(PUBLISHED, '0.2.1-alpha.4', Date.parse('2026-10-16T09:00:00Z'))).toBeUndefined()
  })

  it('rejects a pin the registry does not list', () => {
    expect(() => selectVersion(PUBLISHED, '0.2.1-alpha.9', Date.parse('2026-10-20T12:00:00Z'))).toThrow('0.2.1-alpha.9')
  })
})

describe('DSH canary overrides', () => {
  const declared = { '@deepseek-ai/cordis': '~4.0.5-alpha.3', 'commander': '^15.0.0' }

  it('moves dsh packages to the canary version and other @deepseek-ai packages to its ranges', () => {
    expect(canaryOverrides(['@deepseek-ai/dsh-app-boot', 'vitest', '@deepseek-ai/cordis', '@deepseek-ai/dsh', '@deepseek-ai/dsh'], '0.2.1-alpha.5', declared)).toEqual({
      '@deepseek-ai/cordis': '~4.0.5-alpha.3',
      '@deepseek-ai/dsh': '0.2.1-alpha.5',
      '@deepseek-ai/dsh-app-boot': '0.2.1-alpha.5',
    })
  })

  it('fails on an @deepseek-ai dependency the canary version does not declare', () => {
    expect(() => canaryOverrides(['@deepseek-ai/cordis-plugin-loader'], '0.2.1-alpha.5', declared)).toThrow('@deepseek-ai/cordis-plugin-loader')
  })

  it('appends the overrides to pnpm-workspace.yaml', () => {
    expect(workspaceSettings('0.2.1-alpha.5', { '@deepseek-ai/dsh': '0.2.1-alpha.5', '@deepseek-ai/cordis': '~4.0.5-alpha.3' })).toBe([
      '',
      '# DSH canary (CI copy only): replay against @deepseek-ai/dsh@0.2.1-alpha.5.',
      'overrides:',
      `  '@deepseek-ai/dsh': '0.2.1-alpha.5'`,
      `  '@deepseek-ai/cordis': '~4.0.5-alpha.3'`,
      '',
    ].join('\n'))
  })
})
