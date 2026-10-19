/**
 * qrg-router host row. It will own the decision engine, the delegation
 * registry and the calls to DSH sub-agents; this skeleton only activates.
 * Function plugin: named exports only, a default export would make the
 * Loader ignore them.
 * @module @linagora/qrg-router
 */
import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'qrg-router'

/**
 * Mount the host row.
 * @param _ctx - the row's host context.
 */
export function apply(_ctx: Context): void {}
