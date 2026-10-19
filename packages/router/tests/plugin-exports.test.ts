/**
 * The DSH Loader applies `exports.default ?? exports`: a default export would
 * replace the named `name`/`apply` exports both qrg-router rows rely on.
 */
import { describe, expect, it } from 'vitest'
import * as host from '../src/index.ts'
import * as tools from '../src/tools.ts'

describe('qrg-router plugin modules', () => {
  it.each([
    ['host', host, 'qrg-router'],
    ['tools', tools, 'qrg-router-tools'],
  ])('expose the %s row as named exports only', (_row, plugin, name) => {
    expect(plugin.name).toBe(name)
    expect(plugin.apply).toBeTypeOf('function')
    expect(Object.keys(plugin)).not.toContain('default')
  })
})
