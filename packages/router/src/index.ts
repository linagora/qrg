/**
 * qrg-router host row: decides where a delegated task runs and runs it. At
 * lot 1 every task goes to a native DSH agent on the gateway's fallback
 * model, as a child of the delegating agent in its directory.
 * Function plugin: named exports only, a default export would make the
 * Loader ignore them.
 * @module @linagora/qrg-router
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import z from '@deepseek-ai/schemastery'
import type { TaskDescriptor } from './task.ts'

/** What the host row offers its tools row. */
export interface QrgRouter {
  /**
   * Route a validated task and wait for the delegated agent.
   * @param task - the TaskDescriptor.
   * @param parent - the delegating agent.
   * @param signal - the cancellation of the delegating tool call.
   * @returns the final answer of the delegated agent.
   * @throws Error when the delegated agent does not complete its task.
   */
  delegate(task: TaskDescriptor, parent: Agent, signal: AbortSignal): Promise<string>
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
export const inject = ['subagents']

/** Host row settings, written by the QRG bundle. */
export interface Config {
  /** pi-ai route of the LINAGORA AI Gateway. */
  gateway: string
  /** Gateway model of the native agents. */
  fallbackModel: string
}

export const Config: z<Config> = z.object({
  gateway: z.string().required().description('pi-ai route of the LINAGORA AI Gateway.'),
  fallbackModel: z.string().required().description('Gateway model of the native agents.'),
})

/**
 * Mount the host row.
 * @param ctx - the row's host context.
 * @param config - the gateway route and model.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide('qrgRouter', {
    delegate: (task, parent, signal) => runNative(ctx, config, task, parent, signal),
  })
}

/**
 * Run a task on a native agent of the gateway, as a child of the delegating
 * agent in its directory.
 * @param ctx - the host row's context.
 * @param config - the gateway route and model.
 * @param task - the TaskDescriptor.
 * @param parent - the delegating agent.
 * @param signal - the cancellation of the delegating tool call.
 * @returns the text of the child's final answer.
 */
async function runNative(ctx: Context, config: Config, task: TaskDescriptor, parent: Agent, signal: AbortSignal): Promise<string> {
  const maxDepth = ctx.subagents.resolveMaxDepth()
  const activation = await ctx.subagents.startActivation({
    provider: 'spawn',
    label: task.intent,
    request: {
      prompt: [{ type: 'text', text: task.description }],
      parent,
      // Named in full: without it the child takes the route of the parent's
      // last request (DSH #4065), not the decided one.
      agentOptions: { provider: config.gateway, model: config.fallbackModel },
      ...(maxDepth === undefined ? {} : { maxDepth }),
    },
    signal,
    delivery: 'caller',
  })
  // The start signal stops only the start; a published child stops through dispose.
  const stop = (): void => {
    activation.dispose().catch((error: unknown) => {
      ctx.logger.warn(`qrg-router: the delegated agent ${activation.childId} failed to stop: ${String(error)}`)
    })
  }
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
  try {
    const result = await activation.result
    if (result.stopReason !== 'completed') {
      const diagnostic = result.diagnostic === undefined ? '' : `: ${result.diagnostic}`
      throw new Error(`the delegated agent stopped with ${result.stopReason}${diagnostic}`)
    }
    return result.output.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  } finally {
    signal.removeEventListener('abort', stop)
  }
}
