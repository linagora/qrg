/**
 * The rule policy of `route_and_delegate` (SPEC, component 1): its YAML
 * format, then the decision it gives a task from the task's routing fields,
 * the class computed for its scope and the user's forcing.
 */
import { describe, expect, it } from 'vitest'
import { decide, parsePolicy } from '../src/policy.ts'
import { POLICY_FILE } from './fixtures/policy.ts'

const POLICY = parsePolicy(POLICY_FILE)

describe('rule policy decision', () => {
  it('falls back on the default couple when no rule routes the task', () => {
    expect(decide(POLICY, { intent: 'refactor', interactive: false, sensitivity: 'C0' })).toEqual({
      couple: { id: 'native/qwen3.8', agent: 'native', model: 'qwen3.8' },
      decidedBy: 'fallback',
      options: ['claude-code/claude-opus', 'native/qwen3.8'],
      allowRules: [],
    })
  })

  it.each([
    ['tests', false, 'mechanical-tasks', 'native/qwen3.8'],
    ['specification', true, 'ambiguous-to-grill-me', 'claude-code/claude-opus'],
  ])('lets a rule route a %s task, without the fallback (D-03)', (intent, interactive, rule, couple) => {
    expect(decide(POLICY, { intent, interactive, sensitivity: 'C0' })).toMatchObject({ couple: { id: couple }, decidedBy: 'rule', rule })
  })

  it.each(['C2', 'C3'] as const)('offers a %s task internal couples only, even when a rule routes it to Claude Code (D-02)', sensitivity => {
    expect(decide(POLICY, { intent: 'specification', interactive: true, sensitivity })).toEqual({
      couple: { id: 'native/qwen3.8', agent: 'native', model: 'qwen3.8' },
      decidedBy: 'fallback',
      options: ['native/qwen3.8'],
      allowRules: ['sensitive-stays-internal'],
    })
  })

  it('removes the couples an allow rule leaves out before any rule routes the task', () => {
    const policy = parsePolicy(POLICY_FILE.replace('sensitivity: [C2, C3]', 'sensitivity: [C1, C2, C3]'))
    expect(decide(policy, { intent: 'specification', interactive: true, sensitivity: 'C1' })).toEqual({
      couple: { id: 'native/qwen3.8', agent: 'native', model: 'qwen3.8' },
      decidedBy: 'fallback',
      options: ['native/qwen3.8'],
      allowRules: ['sensitive-stays-internal'],
    })
  })

  it('never lets the fallback take a task that an allow rule keeps from it', () => {
    const policy = parsePolicy(POLICY_FILE
      .replace('rules:', '  - id: native/other\n    agent: native\n    model: other\n    classes: [C0, C1, C2, C3]\nrules:')
      .replace('allow: [native/qwen3.8]', 'allow: [native/other]'))
    expect(decide(policy, { intent: 'tests', interactive: false, sensitivity: 'C3' })).toEqual({
      refused: 'no rule routes the task, and the fallback may not take it: the rule sensitive-stays-internal leaves native/qwen3.8 out',
      options: ['native/other'],
      allowRules: ['sensitive-stays-internal'],
    })
  })

  it('refuses a task that the fallback does not admit, even when the policy skipped the file checks', () => {
    const claude = POLICY.couples.find(couple => couple.agent === 'claude-code')
    if (claude === undefined) throw new Error('the test policy has a Claude Code couple')
    expect(decide({ ...POLICY, fallback: claude }, { intent: 'refactor', interactive: false, sensitivity: 'C3' })).toEqual({
      refused: 'no rule routes the task, and the fallback may not take it: claude-code/claude-opus does not admit C3',
      options: ['native/qwen3.8'],
      allowRules: ['sensitive-stays-internal'],
    })
  })

  it('lets the first rule that routes the task decide', () => {
    const policy = parsePolicy(POLICY_FILE.replace('default:', '  - id: everything-to-claude\n    route: claude-code/claude-opus\ndefault:'))
    expect(decide(policy, { intent: 'tests', interactive: false, sensitivity: 'C0' })).toMatchObject({ rule: 'mechanical-tasks' })
    expect(decide(policy, { intent: 'refactor', interactive: false, sensitivity: 'C0' })).toMatchObject({ rule: 'everything-to-claude' })
  })

  it('gives the same input the same decision a hundred times (D-07)', () => {
    const input = { intent: 'specification', interactive: true, sensitivity: 'C1' } as const
    const decisions = Array.from({ length: 100 }, () => JSON.stringify(decide(parsePolicy(POLICY_FILE), input)))
    expect(new Set(decisions).size).toBe(1)
  })
})

describe('forcing by the user (D-05)', () => {
  it('routes a forced task to the couple of the mention, before any rule', () => {
    expect(decide(POLICY, { intent: 'tests', interactive: false, sensitivity: 'C0', forced: 'claude' })).toEqual({
      couple: { id: 'claude-code/claude-opus', agent: 'claude-code', model: 'claude-opus' },
      decidedBy: 'forced',
      forced: 'claude',
      options: ['claude-code/claude-opus', 'native/qwen3.8'],
      allowRules: [],
    })
  })

  it.each([
    ['the class of the task', POLICY, 'C3' as const, '@claude is refused: claude-code/claude-opus does not admit C3'],
    [
      'an allow rule',
      parsePolicy(POLICY_FILE.replace('sensitivity: [C2, C3]', 'sensitivity: [C1, C2, C3]')),
      'C1' as const,
      '@claude is refused: the rule sensitive-stays-internal leaves claude-code/claude-opus out',
    ],
  ])('refuses with an explanation a forcing that %s forbids', (_reason, policy, sensitivity, refused) => {
    expect(decide(policy, { intent: 'refactor', interactive: false, sensitivity, forced: 'claude' })).toEqual({
      refused,
      forced: 'claude',
      options: ['native/qwen3.8'],
      allowRules: ['sensitive-stays-internal'],
    })
  })

  it('refuses a mention that names no couple', () => {
    expect(decide(POLICY, { intent: 'refactor', interactive: false, sensitivity: 'C0', forced: 'gpt' })).toMatchObject({
      refused: '@gpt is refused: no couple of the policy answers to it',
    })
  })
})

describe('policy file parsing', () => {
  it.each([
    [
      'a couple outside the gateway that admits C2 or C3',
      POLICY_FILE.replace('classes: [C0, C1]', 'classes: [C0, C1, C2]'),
      'couples[0].classes: only native agents, on the LINAGORA gateway, may admit C2 or C3',
    ],
    ['a class twice in a couple', POLICY_FILE.replace('classes: [C0, C1]', 'classes: [C0, C0]'), 'couples[0].classes: duplicate class'],
    [
      'a fallback outside the gateway that names one class four times',
      POLICY_FILE.replace('classes: [C0, C1]', 'classes: [C0, C0, C0, C0]').replace('fallback: native/qwen3.8', 'fallback: claude-code/claude-opus'),
      'couples[0].classes: duplicate class',
    ],
    [
      'a native fallback that misses a class',
      POLICY_FILE.replace('classes: [C0, C1, C2, C3]', 'classes: [C0, C1, C2]'),
      'default.fallback: the fallback admits every class, C0 to C3',
    ],
    ['a duplicate couple id', POLICY_FILE.replace('id: native/qwen3.8', 'id: claude-code/claude-opus'), 'couples[1].id: duplicate couple id'],
    ['a duplicate mention', POLICY_FILE.replace('mention: qwen', 'mention: claude'), 'couples[1].mention: duplicate mention'],
    ['a rule that names an unknown couple', POLICY_FILE.replace('allow: [native/qwen3.8]', 'allow: [native/mistral]'), 'rules[0].allow[0]: unknown couple'],
    ['an unknown fallback', POLICY_FILE.replace('fallback: native/qwen3.8', 'fallback: native/mistral'), 'default.fallback: unknown couple'],
    [
      'a fallback that does not admit every class',
      POLICY_FILE.replace('fallback: native/qwen3.8', 'fallback: claude-code/claude-opus'),
      'default.fallback: the fallback admits every class, C0 to C3',
    ],
    ['unreadable YAML', 'version: 1\ncouples: [\n', 'invalid YAML'],
  ])('refuses %s', (_label, text, reason) => {
    expect(() => parsePolicy(text)).toThrow(reason)
  })
})
