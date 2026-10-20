/**
 * qrg-router tools row, mounted inside each agent preset that lists it. It
 * registers `route_and_delegate`, through which the lead model hands a task
 * to the host row. Function plugin: named exports only.
 * @module @linagora/qrg-router/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TASK_PARAMETERS, parseTask } from './task.ts'

/** Stable Cordis plugin name. */
export const name = 'qrg-router-tools'

/** Services the row uses. */
export const inject = ['tools', 'qrgRouter']

/**
 * Register `route_and_delegate` for the agents of the preset.
 * @param ctx - the row's preset context.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'route_and_delegate',
    description: 'Delegate a self-contained task to an agent chosen by the routing policy of this workspace, and wait for its answer. The policy picks the agent and its model from the task descriptor. The delegated agent does not see this conversation and works in the same workspace.',
    parameters: TASK_PARAMETERS,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args, exec) {
      const task = parseTask(args)
      if (exec.agent === undefined) throw new Error('route_and_delegate needs the calling agent')
      return ctx.qrgRouter.delegate(task, exec.agent, exec.signal)
    },
  }))
}
