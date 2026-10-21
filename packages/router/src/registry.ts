/**
 * The QRG registry: one record per delegation, in a DSH storage domain. It
 * keeps the task's routing fields, never its text, with what the router
 * decided and from what: the class of the task's scope and its evidence,
 * and the fields of the call it ignored.
 * @module @linagora/qrg-router/registry
 */
import { randomUUID } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { z } from 'zod'
import type { RoutingDecision } from './policy.ts'
import type { ScopeClass } from './sensitivity.ts'
import type { TaskDescriptor } from './task.ts'

// Every field but agent and model is optional: the records written before the
// rule policy hold a native agent, its gateway route and model only.
const RecordedRoute = z.object({
  /** `native`, `claude-code` or `acp:<name>`. */
  agent: z.string(),
  /** pi-ai route of a native agent. */
  provider: z.string().optional(),
  /** Model of the delegated agent. */
  model: z.string(),
  /** The couple of the policy's catalogue. */
  couple: z.string().optional(),
  /** The link of the chain that decided: `forced`, `rule` or `fallback`. */
  decidedBy: z.string().optional(),
  /** The rule that routed the task. */
  rule: z.string().optional(),
  /** The mention the user forced. */
  forced: z.string().optional(),
  /** The couples the class and the `allow` rules admitted. */
  options: z.array(z.string()).optional(),
  /** The `allow` rules that applied. */
  allowRules: z.array(z.string()).optional(),
})

const RecordedRefusal = z.object({
  /** Why the policy refused the task, as the user reads it. */
  refused: z.string(),
  /** The mention the user forced, when the refusal is the forcing's. */
  forced: z.string().optional(),
  /** The couples the class and the `allow` rules admitted. */
  options: z.array(z.string()),
  /** The `allow` rules that applied. */
  allowRules: z.array(z.string()),
})

// Intent, class and outcome stay open strings, and the evidence an open
// object: a record written before a value is renamed must not make the
// whole domain fail to open.
const DelegationRecord = z.object({
  task: z.object({
    intent: z.string(),
    scope: z.object({
      paths: z.array(z.string()).optional(),
      language: z.string().optional(),
    }).optional(),
    interactive: z.boolean(),
  }),
  /** The class of the task's scope, and what it was computed from. Absent from the records written before the rule policy. */
  sensitivity: z.object({
    class: z.string(),
    evidence: z.record(z.string(), z.unknown()),
  }).optional(),
  /** Where the task runs and why, or why the policy refused it. */
  decision: z.union([RecordedRoute, RecordedRefusal]),
  /**
   * The fields of the call that the TaskDescriptor does not declare, which
   * the router ignored, such as a class or a route. Absent from the records
   * written before the rule policy.
   */
  ignoredFields: z.array(z.string()).optional(),
  /** Absent until the delegated agent's session exists. */
  childSessionId: z.string().optional(),
  /**
   * `running`, then the child's stop reason, `refused` when the policy
   * refused the task, or `error` when the task could not run.
   */
  outcome: z.string(),
})

/** One delegation of the registry. */
export type DelegationRecord = z.infer<typeof DelegationRecord>

/** Storage domain of the registry, keyed by delegation id. */
export const registryDomain = defineDomain({
  name: 'qrg_router',
  version: 1,
  tables: {
    delegations: domainTable<string, DelegationRecord>(DelegationRecord),
  },
})

/** The open table of delegations. */
export type Delegations = KvTable<string, DelegationRecord>

/**
 * How a delegation ended: the child's stop reason, `refused` when the policy
 * refused the task, or `error` when the task could not run.
 */
export type Outcome = SubagentResult['stopReason'] | 'refused' | 'error'

/** What the router decided for a task, and from what. */
export interface Routing {
  /** The class of the task's scope, and what it was computed from. */
  sensitivity: ScopeClass
  /** The policy's decision. */
  decision: RoutingDecision
  /** pi-ai route of the LINAGORA AI Gateway, where native couples run. */
  gateway: string
  /** The fields of the call that the TaskDescriptor does not declare. */
  ignoredFields: string[]
}

/** The record of one delegation, `running` until finished. */
export interface DelegationEntry {
  /** Key of the record. */
  id: string
  /**
   * Note the delegated agent's session.
   * @param childSessionId - the session id of the child.
   */
  attach(childSessionId: string): Promise<void>
  /**
   * Close the record.
   * @param outcome - how the delegation ended.
   */
  finish(outcome: Outcome): Promise<void>
}

/**
 * Record a delegation once decided, before it runs or is refused.
 * @param delegations - the registry table.
 * @param task - the TaskDescriptor, of which the record keeps the routing fields.
 * @param routing - the decision, and what it was made from.
 * @returns the new record.
 */
export async function beginDelegation(delegations: Delegations, task: TaskDescriptor, routing: Routing): Promise<DelegationEntry> {
  const id = randomUUID()
  // Picked by name, so that a text field added to the descriptor stays out.
  const { intent, scope, interactive } = task
  const { sensitivity, decision, gateway, ignoredFields } = routing
  await delegations.put(id, {
    task: { intent, ...(scope === undefined ? {} : { scope }), interactive },
    sensitivity: { class: sensitivity.class, evidence: { ...sensitivity.evidence } },
    decision: recordedDecision(decision, gateway),
    ignoredFields,
    outcome: 'running',
  })
  return {
    id,
    attach: async childSessionId => {
      await delegations.update(id, record => ({ ...record, childSessionId }))
    },
    finish: async outcome => {
      await delegations.update(id, record => ({ ...record, outcome }))
    },
  }
}

/**
 * Turn a decision into its record, with a native couple's agent, route and
 * model where the records written before the rule policy hold them.
 * @param decision - the policy's decision.
 * @param gateway - pi-ai route of the gateway, where native couples run.
 * @returns the recorded decision.
 */
function recordedDecision(decision: RoutingDecision, gateway: string): DelegationRecord['decision'] {
  if ('refused' in decision) return decision
  const { couple, ...why } = decision
  return { agent: couple.agent, ...(couple.agent === 'native' ? { provider: gateway } : {}), model: couple.model, couple: couple.id, ...why }
}
