/**
 * The rule policy of `route_and_delegate`, the default decision provider of
 * SPEC (component 1): declarative rules over a catalogue of agent/model
 * couples. At lot 1 its chain stops at the rules, then the fallback.
 * @module @linagora/qrg-router/policy
 */
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { SensitivityClass } from './sensitivity.ts'
import { TASK_PARAMETERS } from './task.ts'
import { describeIssue, readYaml } from './yaml-file.ts'

/** The classes only a couple of the LINAGORA gateway may admit. */
const INTERNAL_CLASSES: readonly SensitivityClass[] = ['C2', 'C3']

const Intent = z.enum(TASK_PARAMETERS.intent.enum)

/** Kebab-case, as couple mentions and rule ids are. */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const When = z.strictObject({
  sensitivity: z.union([SensitivityClass, z.array(SensitivityClass).min(1)]).optional(),
  intent: z.union([Intent, z.array(Intent).min(1)]).optional(),
  interactive: z.boolean().optional(),
})

/** What every rule has: its id and its conditions. */
const RULE_SHAPE = { id: z.string().regex(KEBAB_CASE, 'rule ids are kebab-case'), when: When.optional() }

const PolicyFileV1 = z.strictObject({
  version: z.literal(1),
  couples: z.array(z.strictObject({
    id: z.string().min(1),
    agent: z.string().regex(/^(?:native|claude-code|acp:[a-z0-9]+(?:-[a-z0-9]+)*)$/, 'agents are native, claude-code or acp:<name>'),
    model: z.string().min(1),
    classes: z.array(SensitivityClass).min(1),
    mention: z.string().regex(KEBAB_CASE, 'mentions are kebab-case').optional(),
  })).min(1),
  rules: z.array(z.union([
    z.strictObject({ ...RULE_SHAPE, allow: z.array(z.string()).min(1) }),
    z.strictObject({ ...RULE_SHAPE, route: z.string() }),
  ])).optional(),
  default: z.strictObject({ fallback: z.string() }),
}).superRefine((file, ctx) => {
  const ids = new Set<string>()
  const mentions = new Set<string>()
  file.couples.forEach((couple, index) => {
    if (ids.has(couple.id)) ctx.addIssue({ code: 'custom', path: ['couples', index, 'id'], message: 'duplicate couple id' })
    ids.add(couple.id)
    if (couple.mention !== undefined && mentions.has(couple.mention)) {
      ctx.addIssue({ code: 'custom', path: ['couples', index, 'mention'], message: 'duplicate mention' })
    }
    if (couple.mention !== undefined) mentions.add(couple.mention)
    if (new Set(couple.classes).size < couple.classes.length) ctx.addIssue({ code: 'custom', path: ['couples', index, 'classes'], message: 'duplicate class' })
    // Not negotiable (SPEC, component 1): sensitive data never leaves the infrastructure LINAGORA controls.
    if (couple.agent !== 'native' && couple.classes.some(sensitivity => INTERNAL_CLASSES.includes(sensitivity))) {
      ctx.addIssue({ code: 'custom', path: ['couples', index, 'classes'], message: 'only native agents, on the LINAGORA gateway, may admit C2 or C3' })
    }
  })
  file.rules?.forEach((rule, index) => {
    const named = 'allow' in rule ? rule.allow.map((id, at) => ({ id, path: ['rules', index, 'allow', at] })) : [{ id: rule.route, path: ['rules', index, 'route'] }]
    for (const { id, path } of named) if (!ids.has(id)) ctx.addIssue({ code: 'custom', path, message: 'unknown couple' })
  })
})

/** An agent/model couple of the catalogue. */
export interface Couple {
  id: string
  /** `native`, `claude-code` or `acp:<name>`. */
  agent: string
  /** For a native agent, the model of the gateway. */
  model: string
}

/** A couple of the catalogue, with the classes it admits. */
interface CatalogueCouple extends Couple {
  classes: SensitivityClass[]
  /** What the user writes after `@` to force it. */
  mention: string | undefined
}

/** Conditions of a rule, all of which a task must meet. */
interface Conditions {
  sensitivity: SensitivityClass[] | undefined
  intent: string[] | undefined
  interactive: boolean | undefined
}

/** A rule: it either restricts the couples, or routes a task to one. */
type Rule = { id: string, when: Conditions } & ({ allow: string[] } | { route: string })

/** A valid policy. */
export interface Policy {
  couples: CatalogueCouple[]
  rules: Rule[]
  /** The couple of a task no rule routes, unless an `allow` rule leaves it out: a native agent, which admits every class. */
  fallback: CatalogueCouple
}

/**
 * Read a policy file, format version 1.
 * @param text - the file's text.
 * @returns the policy.
 * @throws Error naming why the file is refused.
 */
export function parsePolicy(text: string): Policy {
  const result = PolicyFileV1.safeParse(readYaml(text))
  if (!result.success) throw new Error(result.error.issues.map(describeIssue).join('; '))
  const file = result.data
  const list = <T extends string>(value: T | T[] | undefined): T[] | undefined => typeof value === 'string' ? [value] : value
  const couples = file.couples.map(couple => ({ id: couple.id, agent: couple.agent, model: couple.model, classes: couple.classes, mention: couple.mention }))
  const fallback = couples.find(couple => couple.id === file.default.fallback)
  if (fallback === undefined) throw new Error('default.fallback: unknown couple')
  if (!SensitivityClass.options.every(sensitivity => fallback.classes.includes(sensitivity))) throw new Error('default.fallback: the fallback admits every class, C0 to C3')
  return {
    couples,
    rules: (file.rules ?? []).map(rule => ({
      ...rule,
      when: { sensitivity: list(rule.when?.sensitivity), intent: list(rule.when?.intent), interactive: rule.when?.interactive },
    })),
    fallback,
  }
}

/**
 * Read a policy file for one decision. Read again at each, an edited policy
 * applies to the next delegation, without a restart (D-08).
 * @param path - the policy file.
 * @returns the policy.
 * @throws Error naming the file, and why it cannot be read or is refused.
 */
export async function loadPolicy(path: string): Promise<Policy> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`the routing policy ${path} is unreadable: ${(error as NodeJS.ErrnoException).code ?? String(error)}`)
  }
  try {
    return parsePolicy(text)
  } catch (error) {
    throw new Error(`the routing policy ${path} is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** What a policy decides from. */
export interface PolicyInput {
  intent: string
  interactive: boolean
  /** The class computed for the task's scope. */
  sensitivity: SensitivityClass
  /** The mention of the couple the user forced, without its `@`. */
  forced?: string | undefined
}

/** What a decision weighed, whatever it decided. */
interface Considered {
  /** The couples the task may go to, by the class and the `allow` rules. */
  options: string[]
  /** The `allow` rules that applied. */
  allowRules: string[]
}

/** A task routed to a couple. */
export interface RoutedDecision extends Considered {
  /** Where the task runs. */
  couple: Couple
  /** The link of the chain that decided. */
  decidedBy: 'forced' | 'rule' | 'fallback'
  /** The rule that routed the task. */
  rule?: string
  /** The mention the user forced. */
  forced?: string
}

/** A task the policy refuses: it runs nowhere. */
export interface RefusedDecision extends Considered {
  /** Why, for the user. */
  refused: string
  /** The mention the user forced, when the refusal is the forcing's. */
  forced?: string
}

/** What the policy decided, and why. */
export type RoutingDecision = RoutedDecision | RefusedDecision

/**
 * Decide where a task runs: the couple the user forced, if the class and
 * the `allow` rules admit it, else the first rule that routes the task to
 * an admitted couple, else the fallback, if admitted too.
 * @param policy - the policy.
 * @param input - the task's routing fields, class and forcing.
 * @returns the decision.
 */
export function decide(policy: Policy, input: PolicyInput): RoutingDecision {
  let options = policy.couples.filter(couple => couple.classes.includes(input.sensitivity))
  const allowRules: string[] = []
  // The first `allow` rule that leaves out each couple the class admits.
  const leftOut = new Map<string, string>()
  for (const rule of policy.rules) {
    if (!('allow' in rule) || !applies(rule.when, input)) continue
    for (const option of options) if (!rule.allow.includes(option.id)) leftOut.set(option.id, rule.id)
    options = options.filter(option => rule.allow.includes(option.id))
    allowRules.push(rule.id)
  }
  const considered: Considered = { options: options.map(couple => couple.id), allowRules }
  if (input.forced !== undefined) return force(policy, input.sensitivity, input.forced, considered, leftOut)
  for (const rule of policy.rules) {
    if (!('route' in rule) || !applies(rule.when, input)) continue
    const couple = options.find(option => option.id === rule.route)
    if (couple !== undefined) return { couple: coupleOf(couple), decidedBy: 'rule', rule: rule.id, ...considered }
  }
  // A link of the chain too, the fallback never takes a task its couple may not run (SPEC, component 1).
  const reason = exclusion(policy.fallback, input.sensitivity, leftOut)
  if (reason !== undefined) return { refused: `no rule routes the task, and the fallback may not take it: ${reason}`, ...considered }
  return { couple: coupleOf(policy.fallback), decidedBy: 'fallback', ...considered }
}

/**
 * Route a task to the couple the user forced, or refuse it with the reason.
 * @param policy - the policy.
 * @param sensitivity - the class of the task.
 * @param forced - the mention, without its `@`.
 * @param considered - the couples the class and the `allow` rules admit.
 * @param leftOut - the `allow` rule that leaves out each couple the class admits.
 * @returns the decision.
 */
function force(policy: Policy, sensitivity: SensitivityClass, forced: string, considered: Considered, leftOut: Map<string, string>): RoutingDecision {
  const couple = policy.couples.find(candidate => candidate.mention === forced)
  const refuse = (reason: string): RefusedDecision => ({ refused: `@${forced} is refused: ${reason}`, forced, ...considered })
  if (couple === undefined) return refuse('no couple of the policy answers to it')
  const reason = exclusion(couple, sensitivity, leftOut)
  if (reason !== undefined) return refuse(reason)
  return { couple: coupleOf(couple), decidedBy: 'forced', forced, ...considered }
}

/**
 * Tell why a task may not go to a couple.
 * @param couple - the couple.
 * @param sensitivity - the class of the task.
 * @param leftOut - the `allow` rule that leaves out each couple the class admits.
 * @returns the reason, or undefined when the class and the `allow` rules admit the couple.
 */
function exclusion(couple: CatalogueCouple, sensitivity: SensitivityClass, leftOut: Map<string, string>): string | undefined {
  if (!couple.classes.includes(sensitivity)) return `${couple.id} does not admit ${sensitivity}`
  const rule = leftOut.get(couple.id)
  return rule === undefined ? undefined : `the rule ${rule} leaves ${couple.id} out`
}

/**
 * Strip a catalogue entry down to the couple a decision names.
 * @param couple - the entry.
 * @returns the couple, without what only the policy reads.
 */
function coupleOf(couple: CatalogueCouple): Couple {
  return { id: couple.id, agent: couple.agent, model: couple.model }
}

/**
 * Tell whether a task meets the conditions of a rule.
 * @param when - the conditions.
 * @param input - the task's routing fields and class.
 * @returns true when it meets every condition.
 */
function applies(when: Conditions, input: PolicyInput): boolean {
  return (when.sensitivity?.includes(input.sensitivity) ?? true)
    && (when.intent?.includes(input.intent) ?? true)
    && (when.interactive === undefined || when.interactive === input.interactive)
}
