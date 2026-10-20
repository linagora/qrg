/**
 * Sensitivity class of a set of paths, computed from the repository's
 * `.linagora/sensitivity.yml` as notes/lot0-sensibilite.md specifies it.
 * No model takes part in it.
 * @module @linagora/qrg-router/sensitivity
 */
import { parseDocument } from 'yaml'
import { z } from 'zod'

const SensitivityClass = z.enum(['C0', 'C1', 'C2', 'C3'])

/** Sensitivity class, from C0 public to C3 sensitive. */
export type SensitivityClass = z.infer<typeof SensitivityClass>

const SensitivityFileV1 = z.strictObject({
  version: z.literal(1),
  default: SensitivityClass,
  zones: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'zone ids are kebab-case'),
    class: SensitivityClass,
    paths: z.array(z.string().superRefine((pattern, ctx) => {
      try {
        compilePattern(pattern)
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message })
      }
    })).min(1),
    labels: z.array(z.string()).optional(),
    description: z.string().optional(),
  })).optional(),
}).superRefine((file, ctx) => {
  const ids = new Set<string>()
  file.zones?.forEach((zone, index) => {
    if (ids.has(zone.id)) ctx.addIssue({ code: 'custom', path: ['zones', index, 'id'], message: 'duplicate zone id' })
    ids.add(zone.id)
  })
})

/** A zone of the sensitivity file. */
export interface Zone {
  id: string
  class: SensitivityClass
  /** Patterns of the paths it covers, relative to the repository root. */
  paths: string[]
  labels: string[]
}

/** The content of a valid sensitivity file. */
export interface SensitivityFile {
  /** Class of every path no zone covers. */
  default: SensitivityClass
  zones: Zone[]
}

/**
 * Read a sensitivity file, format version 1.
 * @param text - the file's text.
 * @returns its default class and zones.
 * @throws Error naming why the file is refused.
 */
export function parseSensitivityFile(text: string): SensitivityFile {
  const result = SensitivityFileV1.safeParse(readYaml(text))
  if (!result.success) throw new Error(result.error.issues.map(describeIssue).join('; '))
  const file = result.data
  return {
    default: file.default,
    zones: (file.zones ?? []).map(zone => ({ id: zone.id, class: zone.class, paths: zone.paths, labels: zone.labels ?? [] })),
  }
}

/**
 * Compile a path pattern of the format: relative to the repository root,
 * `/` as separator, `*` within a segment, `**` as a whole segment over any
 * depth, `?` for one character, case ignored. What could exclude a path from
 * a zone without a word is refused: negation, absolute paths, `.` and `..`
 * segments, empty segments, and the characters `[`, `]`, `{`, `}` and `\`,
 * which each tool reads its own way.
 * @param pattern - a pattern of a zone.
 * @returns a regular expression over NFC-normalized paths.
 * @throws Error naming why the pattern is refused.
 */
function compilePattern(pattern: string): RegExp {
  if (pattern === '') throw new Error('empty pattern')
  if (pattern.startsWith('!')) throw new Error('negation is refused')
  if (pattern.startsWith('/')) throw new Error('absolute patterns are refused')
  if (/[[\]{}\\]/.test(pattern)) throw new Error('the characters [ ] { } \\ are refused')
  const segments = pattern.normalize('NFC').split('/')
  const source = segments.map((segment, index) => {
    const last = index === segments.length - 1
    if (segment === '') throw new Error('empty path segment')
    if (segment === '.' || segment === '..') throw new Error(`"${segment}" segments are refused`)
    if (segment === '**') return last ? '.*' : '(?:.*/)?'
    if (segment.includes('**')) throw new Error('"**" must be a whole segment')
    const escaped = segment.replace(/[.+^$()|*?]/g, char => char === '*' ? '[^/]*' : char === '?' ? '[^/]' : `\\${char}`)
    return last ? escaped : `${escaped}/`
  }).join('')
  return new RegExp(`^${source}$`, 'isu')
}

/**
 * Read the YAML of a sensitivity file. Only the code and line of a problem
 * leave this function: the file names the zones and their labels, which a
 * refusal reason does not quote.
 * @param text - the file's text.
 * @returns the document as plain data.
 * @throws Error on a syntax error, a warning such as an unknown tag, or an alias.
 */
function readYaml(text: string): unknown {
  const document = parseDocument(text, { prettyErrors: true })
  const problem = document.errors[0] ?? document.warnings[0]
  if (problem !== undefined) throw new Error(`invalid YAML (${problem.code}) at line ${problem.linePos?.[0].line ?? '?'}`)
  try {
    return document.toJS({ maxAliasCount: 0 })
  } catch {
    throw new Error('invalid YAML: aliases are not allowed')
  }
}

/**
 * Describe a problem of the file by its field and the rule it breaks. The
 * names of unknown fields are left out, as they are the file's content.
 * @param issue - a problem zod found.
 * @returns the description.
 */
function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.reduce<string>(
    (text, key) => typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`,
    '',
  )
  const rule = issue.code === 'unrecognized_keys' ? 'unknown field' : issue.message
  return path === '' ? rule : `${path}: ${rule}`
}
