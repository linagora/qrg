/**
 * A routing policy with the catalogue of SPEC at lot 1, and a Claude Code
 * couple that its rules route to, for the policy and delegation tests.
 */

/** The policy file, with the rules of SPEC's example. */
export const POLICY_FILE = `version: 1
couples:
  - id: claude-code/claude-opus
    agent: claude-code
    model: claude-opus
    classes: [C0, C1]
    mention: claude
  - id: native/qwen3.8
    agent: native
    model: qwen3.8
    classes: [C0, C1, C2, C3]
    mention: qwen
rules:
  - id: sensitive-stays-internal
    when: { sensitivity: [C2, C3] }
    allow: [native/qwen3.8]
  - id: ambiguous-to-grill-me
    when: { intent: specification, interactive: true }
    route: claude-code/claude-opus
  - id: mechanical-tasks
    when: { intent: [tests, documentation, small-fix] }
    route: native/qwen3.8
default:
  fallback: native/qwen3.8
`
