/**
 * Reading of the YAML files qrg-router obeys, the sensitivity file and the
 * routing policy: a refusal names where the file breaks a rule, never what
 * the file says.
 * @module @linagora/qrg-router/yaml-file
 */
import { LineCounter, isScalar, parseDocument, visit } from 'yaml'
import type { Range } from 'yaml'
import type { z } from 'zod'

/**
 * Read the YAML of a file. Only the code and line of a problem leave this
 * function: the file names zones, labels or couples, which a refusal reason
 * does not quote.
 * @param text - the file's text.
 * @returns the document as plain data.
 * @throws Error on a syntax error, a warning such as an unknown tag, a tag,
 *   a `__proto__` key or an alias.
 */
export function readYaml(text: string): unknown {
  const lineCounter = new LineCounter()
  const document = parseDocument(text, { prettyErrors: true, lineCounter })
  const problem = document.errors[0] ?? document.warnings[0]
  if (problem !== undefined) throw new Error(`invalid YAML (${problem.code}) at line ${problem.linePos?.[0].line ?? '?'}`)
  // Refused even where they resolve: a tag makes a value read otherwise than
  // it shows, and zod lets a __proto__ key through where it refuses every
  // other unknown field.
  visit(document, {
    Node(_key, node) {
      if (node.tag !== undefined) throw new Error(`invalid YAML: tags are not allowed (line ${lineOf(lineCounter, node)})`)
    },
    Pair(_key, pair) {
      if (isScalar(pair.key) && pair.key.value === '__proto__') throw new Error(`invalid YAML: the key __proto__ is not allowed (line ${lineOf(lineCounter, pair.key)})`)
    },
  })
  try {
    return document.toJS({ maxAliasCount: 0 })
  } catch {
    throw new Error('invalid YAML: aliases are not allowed')
  }
}

/**
 * Give the line a node of a YAML document starts on.
 * @param lineCounter - the line counter of the document's parse.
 * @param node - the node.
 * @returns the line, from 1, or `?` for a node without a position.
 */
function lineOf(lineCounter: LineCounter, node: { range?: Range | null }): number | string {
  return node.range ? lineCounter.linePos(node.range[0]).line : '?'
}

/**
 * Describe a problem of a file by its field and the rule it breaks. The
 * names of unknown fields are left out, as they are the file's content.
 * @param issue - a problem zod found.
 * @returns the description.
 */
export function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.reduce<string>(
    (text, key) => typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`,
    '',
  )
  const rule = issue.code === 'unrecognized_keys' ? 'unknown field' : issue.message
  return path === '' ? rule : `${path}: ${rule}`
}
