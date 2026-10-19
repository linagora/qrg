/**
 * Test-only Loader row inserted by the composition overlay. Once the dsh
 * launcher commits a successful startup, it writes the QRG host rows of the
 * Loader tree and the agent preset inventory to `config.output`, then asks
 * the launcher for a bounded exit.
 */
import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Probe settings written by the test overlay. */
export interface Config {
  /** Absolute path of the JSON report. */
  output: string
}

export const name = 'qrg-composition-probe'

export const inject = ['loader', 'agentPresets', 'appReady', 'appExit']

/**
 * Report the composition after startup and exit.
 * @param ctx - the probe row's context.
 * @param config - where to write the report.
 */
export function apply(ctx: Context, config: Config): void {
  const ready = ctx.appReady
  const exit = ctx.appExit
  if (ready === undefined || exit === undefined) {
    throw new Error('qrg-composition-probe: the launcher must provide appReady and appExit')
  }
  ctx.effect(() => ready.onReady(() => {
    void report(ctx, config.output).then(
      () => { exit(0) },
      (error: unknown) => {
        writeFileSync(config.output, JSON.stringify({ error: error instanceof Error ? error.stack : String(error) }))
        exit(1)
      },
    )
  }), 'qrg-composition-probe.report')
}

async function report(ctx: Context, output: string): Promise<void> {
  const hostRows = [...ctx.loader.entries()]
    .filter(entry => entry.options.id.startsWith('qrg-') && entry.options.id !== name)
    .map(entry => ({ id: entry.options.id, name: entry.options.name, fiberState: entry.fiber?.state }))
  const presets = await ctx.agentPresets.compositionInventory()
  writeFileSync(output, JSON.stringify({ hostRows, presets }))
}
