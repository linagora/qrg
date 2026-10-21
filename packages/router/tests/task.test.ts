/**
 * D-01: an invalid or incomplete TaskDescriptor is refused explicitly, before
 * any delegation.
 */
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { parseTask } from '../src/task.ts'

const TASK = {
  intent: 'documentation',
  description: 'Document the export command in the README',
  scope: { paths: ['README.md', 'src/export'], language: 'typescript' },
  interactive: false,
}

/**
 * Parse a descriptor expected to be refused.
 * @param value - the candidate arguments.
 * @returns the violations of the refusal.
 */
function refusal(value: unknown): string[] {
  try {
    parseTask(value)
  } catch (error) {
    expect(error).toBeInstanceOf(ToolArgsError)
    return (error as ToolArgsError).violations
  }
  throw new Error('parseTask accepted the descriptor')
}

describe('TaskDescriptor parsing', () => {
  it('accepts a complete descriptor', () => {
    expect(parseTask(TASK)).toEqual(TASK)
  })

  it('refuses an unknown intent', () => {
    expect(refusal({ ...TASK, intent: 'deploy' })).toEqual([expect.stringContaining('"intent"')])
  })

  it.each(['intent', 'description', 'interactive'])('refuses a descriptor without %s', field => {
    const { [field]: _missing, ...incomplete } = TASK as Record<string, unknown>
    expect(refusal(incomplete)).toEqual([expect.stringContaining(`"${field}"`)])
  })

  it('refuses a blank description', () => {
    expect(refusal({ ...TASK, description: ' \n ' })).toEqual([expect.stringContaining('"description"')])
  })

  it.each([
    '/etc/passwd',
    'C:\\Users\\dev\\other-repo',
    'C:other-repo',
    '\\\\server\\share\\other-repo',
    '../other-repo',
    'src/../../other-repo',
    'src\\..\\..\\other-repo',
  ])('refuses the path %s, which leaves the workspace', path => {
    expect(refusal({ ...TASK, scope: { paths: ['README.md', path] } })).toEqual([expect.stringContaining('"scope.paths[1]"')])
  })

  it('refuses an empty path', () => {
    expect(refusal({ ...TASK, scope: { paths: ['README.md', ''] } })).toEqual([expect.stringContaining('"scope.paths[1]"')])
  })

  it.each(['src/**/*.ts', 'qrg_pilot/*/pseudonymize.py', 'src/export?.ts'])('refuses the pattern %s, which names no file', path => {
    expect(refusal({ ...TASK, scope: { paths: ['README.md', path] } })).toEqual([expect.stringContaining('"scope.paths[1]"')])
  })

  it('refuses a scope that names a repository', () => {
    expect(refusal({ ...TASK, scope: { ...TASK.scope, repository: 'linagora/other-repo' } })).toEqual([expect.stringContaining('"scope.repository"')])
  })

  it('keeps only the declared fields, so a model cannot set the sensitivity class', () => {
    expect(parseTask({ ...TASK, sensitivity: 'C0', constraints: { model: 'claude-opus' } })).toEqual(TASK)
  })
})
