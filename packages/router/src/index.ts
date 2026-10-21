/**
 * qrg-router host row: decides where a delegated task runs, runs it and
 * records it in the QRG registry. The rule policy decides from the class
 * computed for the task's scope, in the delegating agent's directory. At
 * lot 1 only native DSH agents run, on the gateway, as children of the
 * delegating agent in its directory.
 * Function plugin: named exports only, a default export would make the
 * Loader ignore them.
 * @module @linagora/qrg-router
 */
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-working-directory'
import z from '@deepseek-ai/schemastery'
import { decide, loadPolicy } from './policy.ts'
import type { RoutingDecision } from './policy.ts'
import { beginDelegation, registryDomain } from './registry.ts'
import type { Delegations, Outcome, Routing } from './registry.ts'
import { classifyScope } from './sensitivity.ts'
import type { ScopeClass } from './sensitivity.ts'
import type { TaskDescriptor } from './task.ts'

/** What the host row offers its tools row. */
export interface QrgRouter {
  /**
   * Route a validated task and wait for the delegated agent.
   * @param task - the TaskDescriptor.
   * @param ignoredFields - the fields of the call that the TaskDescriptor
   *   does not declare, which the record names.
   * @param parent - the delegating agent.
   * @param signal - the cancellation of the delegating tool call.
   * @returns the final answer of the delegated agent.
   * @throws Error when the policy cannot be read, when it refuses the task,
   *   or when the delegated agent does not complete it.
   */
  delegate(task: TaskDescriptor, ignoredFields: string[], parent: Agent, signal: AbortSignal): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The qrg-router host row, for its tools row. */
    qrgRouter: QrgRouter
  }
}

/** Stable Cordis plugin name. */
export const name = 'qrg-router'

/** Services the row uses. */
export const inject = ['subagents', 'storageDomain', 'workingDirectory']

/** Host row settings, written by the QRG bundle. */
export interface Config {
  /** pi-ai route of the LINAGORA AI Gateway. */
  gateway: string
  /** Path of the routing policy file, read again at each delegation; a relative path is read from the profile directory. */
  policy: string
}

export const Config: z<Config> = z.object({
  gateway: z.string().required().description('pi-ai route of the LINAGORA AI Gateway.'),
  policy: z.string().required().description('Path of the routing policy file, read again at each delegation; a relative path is read from the profile directory.'),
})

/**
 * Mount the host row once its registry is open.
 * @param ctx - the row's host context.
 * @param config - the gateway route and the policy file.
 * @throws Error when the policy path is relative outside a dsh profile.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const policyPath = resolvePolicyPath(ctx, config.policy)
  const registry = await ctx.storageDomain.open(registryDomain)
  ctx.effect(() => () => registry.close(), 'qrg-router.registry')
  const delegations = registry.table('delegations')
  ctx.provide('qrgRouter', {
    delegate: async (task, ignoredFields, parent, signal) => {
      const { sensitivity, decision } = await decideRouting(ctx, policyPath, task, parent, signal)
      return runRecorded(ctx, delegations, { task, routing: { sensitivity, decision, gateway: config.gateway, ignoredFields }, parent, signal })
    },
  })
}

/**
 * Resolve the policy path of the config.
 * @param ctx - the row's host context.
 * @param path - the path the config gives.
 * @returns the absolute path of the policy file.
 * @throws Error when the path is relative and no dsh profile gives its directory.
 */
function resolvePolicyPath(ctx: Context, path: string): string {
  if (isAbsolute(path)) return path
  // Never from the directory dsh was started from, which changes from one launch to the next.
  const profile = ctx.get('profileContext')
  if (profile === undefined) throw new Error(`qrg-router: the policy path ${path} is relative, and no dsh profile gives its directory`)
  return join(profile.dir, path)
}

/**
 * Decide where a task runs, by the policy as its file reads now.
 * @param ctx - the host row's context.
 * @param policyPath - the policy file.
 * @param task - the TaskDescriptor.
 * @param parent - the delegating agent.
 * @param signal - the cancellation of the delegating tool call.
 * @returns the class of the task's scope, and the policy's decision.
 * @throws Error when the policy file cannot be read or is refused.
 */
async function decideRouting(
  ctx: Context,
  policyPath: string,
  task: TaskDescriptor,
  parent: Agent,
  signal: AbortSignal,
): Promise<{ sensitivity: ScopeClass, decision: RoutingDecision }> {
  const policy = await loadPolicy(policyPath)
  // The child works in this directory too (SPEC, at lot 1).
  const workspace = await ctx.workingDirectory.ensure(parent, signal)
  const sensitivity = await classifyScope(workspace, task.scope?.paths ?? [])
  const decision = decide(policy, {
    intent: task.intent,
    interactive: task.interactive,
    sensitivity: sensitivity.class,
    forced: task.constraints?.forced,
  })
  return { sensitivity, decision }
}

/** One delegation, once decided. */
interface Delegation {
  /** The TaskDescriptor. */
  task: TaskDescriptor
  /** The decision, and what it was made from. */
  routing: Routing
  /** The delegating agent. */
  parent: Agent
  /** The cancellation of the delegating tool call. */
  signal: AbortSignal
}

/**
 * Run a delegation under a registry record that ends with the outcome: the
 * policy's refusal, the absence of the decided agent, or the child's stop
 * reason.
 * @param ctx - the host row's context.
 * @param delegations - the registry table.
 * @param delegation - the task, the decision and for whom.
 * @returns the text of the delegated agent's final answer.
 */
async function runRecorded(ctx: Context, delegations: Delegations, delegation: Delegation): Promise<string> {
  // Written first: no delegation runs, nor is refused, without its record.
  const entry = await beginDelegation(delegations, delegation.task, delegation.routing)
  let outcome: Outcome = 'error'
  try {
    const { decision, gateway } = delegation.routing
    if ('refused' in decision) {
      outcome = 'refused'
      throw new Error(decision.refused)
    }
    const { couple } = decision
    // Claude Code and the ACP agents run from #18 on.
    if (couple.agent !== 'native') throw new Error(`${couple.id} is not available: only native agents run for now`)
    const result = await runNative(ctx, delegation, { provider: gateway, model: couple.model }, childSessionId => {
      void warnOnFailure(ctx, entry.attach(childSessionId), `delegation ${entry.id} lost its child session`)
    })
    outcome = result.stopReason
    if (result.stopReason !== 'completed') {
      const diagnostic = result.diagnostic === undefined ? '' : `: ${result.diagnostic}`
      throw new Error(`the delegated agent stopped with ${result.stopReason}${diagnostic}`)
    }
    return result.output.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  } finally {
    await warnOnFailure(ctx, entry.finish(outcome), `delegation ${entry.id} lost its outcome ${outcome}`)
  }
}

/**
 * Log the failure of a step that must not fail the delegation.
 * @param ctx - the host row's context.
 * @param step - the step's promise.
 * @param failure - what the failure means, for the log.
 * @returns a promise that settles with the step and never rejects.
 */
async function warnOnFailure(ctx: Context, step: Promise<unknown>, failure: string): Promise<void> {
  try {
    await step
  } catch (error) {
    ctx.logger.warn(`qrg-router: ${failure}: ${String(error)}`)
  }
}

/**
 * Run a delegation on a native agent of the gateway, as a child of the
 * delegating agent in its directory.
 * @param ctx - the host row's context.
 * @param delegation - the task, and for whom.
 * @param route - the gateway's pi-ai route and the model of the decided couple.
 * @param onChildSession - called with the child's session id once it exists.
 * @returns the child's result.
 */
async function runNative(
  ctx: Context,
  delegation: Delegation,
  route: { provider: string, model: string },
  onChildSession: (childSessionId: string) => void,
): Promise<SubagentResult> {
  const { task, parent, signal } = delegation
  const maxDepth = ctx.subagents.resolveMaxDepth()
  const activation = await ctx.subagents.startActivation({
    provider: 'spawn',
    label: task.intent,
    request: {
      prompt: [{ type: 'text', text: task.description }],
      parent,
      // Named in full: without it the child takes the route of the parent's
      // last request (DSH #4065), not the decided one.
      agentOptions: { provider: route.provider, model: route.model },
      ...(maxDepth === undefined ? {} : { maxDepth }),
    },
    signal,
    delivery: 'caller',
  })
  onChildSession(activation.childId)
  // The start signal stops only the start; a published child stops through dispose.
  const stop = (): void => {
    void warnOnFailure(ctx, activation.dispose(), `the delegated agent ${activation.childId} failed to stop`)
  }
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
  try {
    return await activation.result
  } finally {
    signal.removeEventListener('abort', stop)
  }
}
