/**
 * The format of `.linagora/sensitivity.yml`, version 1, and its refusals
 * (notes/lot0-sensibilite.md). A refused file sends the whole repository to
 * C3, which the classification tests cover.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSensitivityFile } from '../src/sensitivity.ts'

const PILOT_FILE = readFileSync(new URL('fixtures/pilot/tree/.linagora/sensitivity.yml', import.meta.url), 'utf8')

const HEADER = 'version: 1\ndefault: C0\n'
const ZONE = '  - id: secrets\n    class: C3\n    paths: ["secrets/**"]\n'

/**
 * Parse a file expected to be refused.
 * @param text - the candidate file.
 * @returns the reason of the refusal.
 */
function refusal(text: string): string {
  try {
    parseSensitivityFile(text)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('parseSensitivityFile accepted the file')
}

describe('sensitivity file parsing', () => {
  it.each([
    ['unreadable YAML', 'version: 1\ndefault: [C0\n', 'YAML'],
    ['a duplicate key', `${HEADER}default: C3\n`, 'DUPLICATE_KEY'],
    ['a custom tag', 'version: 1\ndefault: !!js C0\n', 'TAG_RESOLVE_FAILED'],
    ['an alias', 'version: 1\ndefault: &public C0\nzones:\n  - id: secrets\n    class: *public\n    paths: ["secrets/**"]\n', 'alias'],
    ['an unknown version', 'version: 2\ndefault: C0\n', 'version'],
    ['no version', 'default: C0\n', 'version'],
    ['an unknown default class', 'version: 1\ndefault: C4\n', 'default'],
    ['no default class', 'version: 1\n', 'default'],
    ['an unknown zone class', `${HEADER}zones:\n  - id: secrets\n    class: secret\n    paths: ["secrets/**"]\n`, 'zones[0].class'],
    ['a zone id outside kebab-case', `${HEADER}zones:\n  - id: Secrets_Zone\n    class: C3\n    paths: ["secrets/**"]\n`, 'zones[0].id'],
    ['a zone without paths', `${HEADER}zones:\n  - id: secrets\n    class: C3\n    paths: []\n`, 'zones[0].paths'],
  ])('refuses %s', (_label, text, mention) => {
    expect(refusal(text)).toContain(mention)
  })

  it.each([
    ['an unknown root field', `${HEADER}acme-payroll: true\n`, 'unknown field'],
    ['an unknown zone field', `${HEADER}zones:\n${ZONE}    acme-payroll: true\n`, 'zones[0]: unknown field'],
    ['a duplicate zone id', `${HEADER}zones:\n  - id: acme-payroll\n${ZONE.slice(ZONE.indexOf('\n') + 1)}  - id: acme-payroll\n${ZONE.slice(ZONE.indexOf('\n') + 1)}`, 'zones[1].id: duplicate zone id'],
  ])('gives the field and the rule of %s, without quoting the file', (_label, text, reason) => {
    expect(refusal(text)).toBe(reason)
  })

  it.each([
    '',
    '!secrets/public/**',
    '/secrets/**',
    'secrets/../public/**',
    './secrets/**',
    'secrets//keys/**',
    'secrets/',
    'secrets/[ab]/**',
    'secrets/{a,b}/**',
    'secrets\\**',
    'secrets/**.pem',
    '**secrets/**',
    'secrets/***',
  ])('refuses the pattern "%s"', pattern => {
    expect(refusal(`${HEADER}zones:\n  - id: secrets\n    class: C3\n    paths: ["keys/**", ${JSON.stringify(pattern)}]\n`)).toContain('zones[0].paths[1]')
  })

  it('reads the zones of the pilot file', () => {
    expect(parseSensitivityFile(PILOT_FILE)).toEqual({
      default: 'C0',
      zones: [
        { id: 'pilot-public', class: 'C0', paths: ['qrg_pilot/c0_public/**'], labels: [] },
        { id: 'pilot-internal-tooling', class: 'C1', paths: ['qrg_pilot/c1_internal/**'], labels: ['internal-tooling'] },
        { id: 'pilot-client-acme', class: 'C2', paths: ['qrg_pilot/c2_client_acme/**'], labels: ['client:acme', 'public-procurement'] },
        { id: 'pilot-secnumcloud', class: 'C3', paths: ['qrg_pilot/c3_secnumcloud/**'], labels: ['secnumcloud', 'personal-data', 'secrets'] },
      ],
    })
  })
})
