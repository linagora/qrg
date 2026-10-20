/**
 * The TaskDescriptor the lead model passes to `route_and_delegate`. The
 * sensitivity class is not part of it: the plugin computes it from the
 * repository metadata, never from what a model says.
 * @module @linagora/qrg-router/task
 */
import { posix, win32 } from 'node:path'
import { ToolArgsError, validateArgs } from '@deepseek-ai/dsh-tools'
import type { InferArgs } from '@deepseek-ai/dsh-tools'

/** Tool parameters of `route_and_delegate`. */
export const TASK_PARAMETERS = {
  intent: {
    type: 'string',
    enum: ['refactor', 'review', 'tests', 'documentation', 'specification', 'debugging', 'small-fix'],
    description: 'Kind of task.',
    required: true,
  },
  description: {
    type: 'string',
    description: 'What the delegated agent must do, self-contained: it does not see this conversation.',
    required: true,
  },
  scope: {
    type: 'object',
    additionalProperties: false,
    description: 'Estimated scope, within the current workspace. Omit it when the task may touch the whole repository.',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files or directories the task touches, relative to the workspace root; a directory covers everything under it.',
      },
      language: { type: 'string', description: 'Main programming language of the task.' },
    },
  },
  interactive: {
    type: 'boolean',
    description: 'Whether the task needs a dialogue with the user.',
    required: true,
  },
} as const

/** A validated TaskDescriptor. */
export type TaskDescriptor = InferArgs<typeof TASK_PARAMETERS>

/**
 * Tell whether a scope path could designate something outside the workspace,
 * on POSIX or Windows.
 * @param path - a path of the descriptor's scope.
 * @returns true for a rooted path (`/x`, `C:\x`, `C:x`, `\\server\share`) or
 *   a path with a `..` segment.
 */
function leavesWorkspace(path: string): boolean {
  return posix.parse(path).root !== '' || win32.parse(path).root !== '' || path.split(/[\\/]/).includes('..')
}

/**
 * Validate the arguments of a `route_and_delegate` call.
 * @param value - the arguments as the lead model sent them.
 * @returns the descriptor, rebuilt from its declared fields only: the
 *   parameter root stays open, as every DSH tool's does.
 * @throws ToolArgsError listing the schema violations, or else every
 *   violation of the blank and scope checks.
 */
export function parseTask(value: unknown): TaskDescriptor {
  const schemaViolations = validateArgs(TASK_PARAMETERS, value)
  if (schemaViolations.length > 0) throw new ToolArgsError(schemaViolations)
  const { intent, description, scope, interactive } = value as TaskDescriptor
  const violations: string[] = []
  if (description.trim() === '') violations.push('"description" must not be blank')
  scope?.paths?.forEach((path, index) => {
    if (path === '') violations.push(`"scope.paths[${index}]" must not be empty`)
    else if (leavesWorkspace(path)) violations.push(`"scope.paths[${index}]" must stay in the workspace: relative, without ".." segments`)
  })
  if (violations.length > 0) throw new ToolArgsError(violations)
  return { intent, description, ...(scope === undefined ? {} : { scope }), interactive }
}
