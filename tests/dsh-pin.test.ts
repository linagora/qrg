/**
 * DSH alphas change their APIs, and dsh skips at startup, without an error, a
 * bundle whose `engines.dsh` misses the running version. Every
 * `@deepseek-ai/dsh*` dependency and every workspace `engines.dsh` therefore
 * hold the one exact version the bundle declares, and a DSH bump moves them
 * all in the same change.
 */
import { describe, expect, it } from 'vitest'
import { isDshPackage, pinnedDshVersion, readWorkspace, workspaceDependencies } from '../scripts/workspace.ts'

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const workspace = readWorkspace()
const pinned = pinnedDshVersion(workspace.packages)

describe('DSH pin', () => {
  it('is the exact version in the bundle engines.dsh', () => {
    expect(pinned).toMatch(EXACT_VERSION)
  })

  it('holds for the engines.dsh of every workspace package', () => {
    const offPin = workspace.packages
      .map(pkg => ({ package: pkg.name, enginesDsh: pkg.engines?.['dsh'] }))
      .filter(entry => entry.enginesDsh !== pinned)
    expect(offPin).toEqual([])
  })

  it('holds for every @deepseek-ai/dsh* dependency', () => {
    const dependencies = workspaceDependencies(workspace).filter(dependency => isDshPackage(dependency.name))
    expect(dependencies).not.toEqual([])
    expect(dependencies.filter(dependency => dependency.version !== pinned)).toEqual([])
  })
})
