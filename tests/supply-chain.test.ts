/**
 * pnpm 11 holds back the versions published less than 24 hours ago. In its
 * default loose mode, a resolution that picks one adds it to
 * `minimumReleaseAgeExclude` in pnpm-workspace.yaml by itself, and frozen
 * installs honor that exemption afterwards. The workspace therefore runs in
 * strict mode, and no @deepseek-ai package may be exempted.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from '../scripts/workspace.ts'

const settings = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')

/**
 * Cut a top-level setting out of pnpm-workspace.yaml.
 * @param key - setting name.
 * @returns its lines without comments or blank lines, up to the next
 *   top-level setting; none when the file does not set it.
 */
function topLevelSetting(key: string): string[] {
  const lines = settings.split('\n').filter(line => !/^\s*(?:#|$)/.test(line))
  const start = lines.findIndex(line => line.startsWith(`${key}:`))
  if (start === -1) return []
  const end = lines.findIndex((line, index) => index > start && !/^[\s-]/.test(line))
  return lines.slice(start, end === -1 ? undefined : end)
}

describe('pnpm release-age gate', () => {
  it('runs in strict mode', () => {
    expect(topLevelSetting('minimumReleaseAgeStrict')).toEqual(['minimumReleaseAgeStrict: true'])
  })

  it('exempts no @deepseek-ai package', () => {
    expect(topLevelSetting('minimumReleaseAgeExclude').filter(line => line.includes('@deepseek-ai/'))).toEqual([])
  })
})
