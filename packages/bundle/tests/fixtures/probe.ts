/**
 * Test-only Loader row inserted by the composition overlays. Once the dsh
 * launcher commits a successful startup, it writes what the composition
 * mounted to `config.output`, then asks the launcher for a bounded exit.
 */
import { writeFileSync } from 'node:fs'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'

/** cordis declares FiberState as a const enum, erased at runtime; the annotation checks the value. */
export const FIBER_ACTIVE: FiberState.ACTIVE = 2

/** Probe settings written by the test overlay. */
export interface Config {
  /** Absolute path of the JSON report. */
  output: string
}

/** What the probe writes to `config.output`. */
export interface ProbeReport {
  /** The QRG rows of the Loader tree. */
  hostRows: { id: string, name: string, fiberState?: FiberState | undefined }[]
  /** The id and plugin of every active row of the Loader tree. */
  activeRows: { id: string, name: string }[]
  /** The model new agents start on. */
  defaultModel: { provider: string, model: string }
  /** The registered model routes. */
  providers: string[]
  /**
   * The selectable permission presets and the one new sessions start with,
   * the sandbox mode of a session that picks none, and the approval policy.
   */
  permission: { presets: string[], defaultPreset: string, sandboxMode: string, approvalPolicy: string | undefined }
  /** The agent preset inventory. */
  agentPresets: Awaited<ReturnType<Context['agentPresets']['compositionInventory']>>
}

export const name = 'qrg-composition-probe'

export const inject = ['loader', 'agentPresets', 'agentDefaultModel', 'llm', 'permissionPresets', 'sandboxPolicy', 'approval', 'appReady', 'appExit']

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
  const entries = [...ctx.loader.entries()].filter(entry => entry.options.id !== name)
  const { provider, model } = ctx.agentDefaultModel.currentSelection()
  const catalog = ctx.permissionPresets.catalog()
  const result: ProbeReport = {
    hostRows: entries
      .filter(entry => entry.options.id.startsWith('qrg-'))
      .map(entry => ({ id: entry.options.id, name: entry.options.name, fiberState: entry.fiber?.state })),
    activeRows: entries
      .filter(entry => entry.fiber?.state === FIBER_ACTIVE)
      .map(entry => ({ id: entry.options.id, name: entry.options.name })),
    defaultModel: { provider, model },
    providers: ctx.llm.listProviders().map(info => info.id),
    permission: {
      presets: catalog.options.map(option => option.value),
      defaultPreset: catalog.defaultPreset,
      sandboxMode: ctx.sandboxPolicy.defaultMode,
      approvalPolicy: ctx.approval.config.policy,
    },
    agentPresets: await ctx.agentPresets.compositionInventory(),
  }
  writeFileSync(output, JSON.stringify(result))
}
