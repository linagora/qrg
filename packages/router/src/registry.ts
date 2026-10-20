/**
 * The QRG registry: one record per delegation, in a DSH storage domain. It
 * keeps the task's routing fields, never its text.
 * @module @linagora/qrg-router/registry
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

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
