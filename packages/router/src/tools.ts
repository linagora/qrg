/**
 * qrg-router tools row, mounted inside each agent preset that lists it. It
 * will register the model-facing tools that reach the host row; this
 * skeleton only activates. Function plugin: named exports only.
 * @module @linagora/qrg-router/tools
 */
import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'qrg-router-tools'

/**
 * Mount the tools row in an agent preset.
 * @param _ctx - the row's preset context.
 */
export function apply(_ctx: Context): void {}
