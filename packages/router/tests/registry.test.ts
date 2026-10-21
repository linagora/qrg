/**
 * The records of the QRG registry stay readable from one version of
 * qrg-router to the next: DSH opens a storage domain only when every stored
 * record passes its schema, and qrg-router does not mount without it.
 */
import { describe, expect, it } from 'vitest'
import { registryDomain } from '../src/registry.ts'

const { valueSchema } = registryDomain.tables.delegations

describe('registry records', () => {
  it('reads a record written before the rule policy', () => {
    const record = {
      task: { intent: 'documentation', scope: { paths: ['README.md'] }, interactive: false },
      decision: { agent: 'native', provider: 'linagora', model: 'qwen3.8' },
      childSessionId: 'session-1',
      outcome: 'completed',
    }
    expect(valueSchema.parse(record)).toEqual(record)
  })

  it('reads a refused forcing, with the class and the ignored fields', () => {
    const record = {
      task: { intent: 'refactor', scope: { paths: ['src/secrets'] }, interactive: false },
      sensitivity: { class: 'C3', evidence: { zones: ['secrets'], fellBack: false } },
      decision: { refused: '@claude is refused: claude-code/claude-opus does not admit C3', forced: 'claude', options: ['native/qwen3.8'], allowRules: [] },
      ignoredFields: ['sensitivity'],
      outcome: 'refused',
    }
    expect(valueSchema.parse(record)).toEqual(record)
  })

  it('reads a task the policy refused without a forcing', () => {
    const record = {
      task: { intent: 'tests', interactive: false },
      sensitivity: { class: 'C3', evidence: { zones: [], fellBack: true } },
      decision: {
        refused: 'no rule routes the task, and the fallback may not take it: the rule sensitive-stays-internal leaves native/qwen3.8 out',
        options: ['native/other'],
        allowRules: ['sensitive-stays-internal'],
      },
      ignoredFields: [],
      outcome: 'refused',
    }
    expect(valueSchema.parse(record)).toEqual(record)
  })
})
