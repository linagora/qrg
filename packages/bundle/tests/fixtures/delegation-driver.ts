/**
 * Test-only Loader row inserted by the delegation test overlay. Once the dsh
 * launcher commits a successful startup, it runs the configured conversations
 * one after another, each in a new session, through the session controller
 * the web client calls. It then writes the settled children and the QRG
 * registry to `config.output`, and asks the launcher for a bounded exit.
 */
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subagent'

/** One user action in a conversation: a prompt, a model choice in the picker, or a file written between two prompts. */
export type Step = { prompt: string } | { selectModel: { provider: string, model: string } } | { writeFile: { path: string, text: string } }

/** Driver settings written by the test overlay. */
export interface Config {
  /** Absolute path of the JSON report. */
  output: string
  /** The conversations, each a list of steps. */
  conversations: Step[][]
}

/** What the driver writes to `config.output`. */
export interface DriverReport {
  /** Every settled child, in settlement order. */
  children: { id: string, stopReason: string }[]
  /** The records of the QRG registry, or null when qrg-router did not open it. */
  registry: unknown[] | null
}

export const name = 'qrg-delegation-driver'

export const inject = ['sessionController', 'agents', 'storageDomain', 'appReady', 'appExit']

/**
 * Run the conversations after startup, report and exit.
 * @param ctx - the driver row's context.
 * @param config - the conversations and where to write the report.
 */
export function apply(ctx: Context, config: Config): void {
  const ready = ctx.appReady
  const exit = ctx.appExit
  if (ready === undefined || exit === undefined) {
    throw new Error('qrg-delegation-driver: the launcher must provide appReady and appExit')
  }
  const children: DriverReport['children'] = []
  ctx.on('subagent/end', info => { children.push({ id: info.id, stopReason: info.stopReason }) })
  ctx.effect(() => ready.onReady(() => {
    void drive(ctx, config.conversations).then(
      () => {
        const report: DriverReport = { children, registry: readRegistry(ctx) }
        writeFileSync(config.output, JSON.stringify(report))
        exit(0)
      },
      (error: unknown) => {
        // The launcher's failure message carries stderr, not the report.
        process.stderr.write(`qrg-delegation-driver: ${error instanceof Error ? error.stack : String(error)}\n`)
        exit(1)
      },
    )
  }), 'qrg-delegation-driver.drive')
}

async function drive(ctx: Context, conversations: Step[][]): Promise<void> {
  for (const steps of conversations) {
    const { sessionId } = await ctx.sessionController.create({})
    for (const step of steps) {
      if ('selectModel' in step) {
        await ctx.sessionController.selectModel({ sessionId, ...step.selectModel })
        continue
      }
      if ('writeFile' in step) {
        await writeFile(step.writeFile.path, step.writeFile.text)
        continue
      }
      await ctx.sessionController.prompt({
        requestId: randomUUID() as SessionRequestId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: step.prompt }],
      }, new AbortController().signal)
      const agent = ctx.agents.get(sessionId)
      if (agent === undefined) throw new Error(`session ${sessionId} has no live agent after its prompt`)
      await agent.whenIdle()
    }
  }
}

function readRegistry(ctx: Context): unknown[] | null {
  const registry = ctx.storageDomain.get('qrg_router')
  return registry === undefined ? null : [...registry.table('delegations').entries()].map(([, record]) => record)
}
