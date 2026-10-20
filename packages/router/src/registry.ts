/**
 * The QRG registry: one record per delegation, in a DSH storage domain. It
 * keeps the task's routing fields, never its text.
 * @module @linagora/qrg-router/registry
 */
import { randomUUID } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { z } from 'zod'
import type { TaskDescriptor } from './task.ts'

const RoutingDecision = z.object({
  agent: z.literal('native'),
  /** pi-ai route of the delegated agent. */
  provider: z.string(),
  /** Model of the delegated agent. */
  model: z.string(),
})

/** Where a delegated task runs, as the router decided it. */
export type RoutingDecision = z.infer<typeof RoutingDecision>

// Intent and outcome stay open strings: a record written before a value is
// renamed must not make the whole domain fail to open.
const DelegationRecord = z.object({
  task: z.object({
    intent: z.string(),
    scope: z.object({
      paths: z.array(z.string()).optional(),
      language: z.string().optional(),
    }).optional(),
    interactive: z.boolean(),
  }),
  decision: RoutingDecision,
  /** Absent until the delegated agent's session exists. */
  childSessionId: z.string().optional(),
  /** `running`, then the child's stop reason, or `error` when it could not run. */
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

/** How a delegation ended: the child's stop reason, or `error` when it could not run. */
export type Outcome = SubagentResult['stopReason'] | 'error'

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
 * Record a delegation before it runs.
 * @param delegations - the registry table.
 * @param task - the TaskDescriptor, of which the record keeps the routing fields.
 * @param decision - where the task runs.
 * @returns the new record.
 */
export async function beginDelegation(delegations: Delegations, task: TaskDescriptor, decision: RoutingDecision): Promise<DelegationEntry> {
  const id = randomUUID()
  // Picked by name, so that a text field added to the descriptor stays out.
  const { intent, scope, interactive } = task
  const routing = { intent, ...(scope === undefined ? {} : { scope }), interactive }
  await delegations.put(id, { task: routing, decision, outcome: 'running' })
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
