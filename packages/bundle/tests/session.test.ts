/**
 * A session on the `qrg` profile under network capture: the lead model,
 * served by a local fake gateway, asks for a web page, and the dsh process
 * records every connection and name lookup it tries, refused unless local.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { egressCaptureEnv, readEgressLog } from './fixtures/egress.ts'
import type { EgressAttempt } from './fixtures/egress.ts'
import { startFakeGateway, textReply, toolCallReply } from './fixtures/fake-gateway.ts'
import type { FakeGateway, GatewayRequest } from './fixtures/fake-gateway.ts'
import { LAUNCH_TEST_TIMEOUT_MS, TELEMETRY_SWITCH_UNSET, launchQrgProfile } from './fixtures/launch.ts'

const driverPath = fileURLToPath(new URL('fixtures/delegation-driver.ts', import.meta.url))

/** A fake key, under a variable of its own: the route's real variable stays cleared. */
const GATEWAY_KEY_ENV = 'QRG_TEST_GATEWAY_KEY'

/** Host of the page the lead model fetches: the capture must see the attempt and refuse it. */
const PROBE_HOST = 'qrg-egress-probe.invalid'

/** Tools of DSH delegation, of the Claude Code bundle and of web search. */
const ABSENT_TOOLS = ['subagent', 'subagent_fork', 'workflow', 'send_message', 'interrupt_agent', 'list_agents', 'subagent_claude_code', 'web_search']

const DEEPSEEK_HOST = /(^|\.)deepseek(svc)?\.com\.?$/i

describe('a session on the qrg profile', () => {
  let gateway: FakeGateway | undefined
  let cwd: string | undefined
  let gatewayPort: number
  let requests: GatewayRequest[]
  let egress: EgressAttempt[]

  beforeAll(async () => {
    gateway = await startFakeGateway([
      toolCallReply('web_fetch', { url: `https://${PROBE_HOST}/` }),
      textReply('The page is out of reach.'),
    ])
    gatewayPort = Number(new URL(gateway.url).port)
    cwd = await mkdtemp(join(tmpdir(), 'qrg-profile-session-'))
    const log = join(cwd, 'egress.jsonl')
    await launchQrgProfile({
      label: 'QRG profile session',
      cwd,
      overlay: [
        { id: 'llm-pi-ai', config: { providers: { linagora: { apiKeyEnv: GATEWAY_KEY_ENV, api: 'openai-completions', baseURL: gateway.url, models: [{ id: 'qwen3.8' }] } } } },
        // Its first-prompt title request would race the scripted replies.
        { id: 'session-title-llm', disabled: true },
        {
          insert: [{
            id: 'qrg-delegation-driver',
            name: driverPath,
            config: { output: join(cwd, 'report.json'), conversations: [[{ prompt: 'Fetch the probe page' }]] },
          }],
        },
      ],
      env: { ...TELEMETRY_SWITCH_UNSET, ...egressCaptureEnv(log), [GATEWAY_KEY_ENV]: 'qrg-test-gateway-key' },
    })
    requests = gateway.requests
    egress = await readEgressLog(log)
  }, LAUNCH_TEST_TIMEOUT_MS)

  afterAll(async () => {
    await gateway?.close()
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true })
  })

  it('offers route_and_delegate and web_fetch, but neither DSH delegation nor web search', () => {
    const tools = requests[0]?.body.tools?.map(tool => tool.function.name) ?? []
    expect(tools).toEqual(expect.arrayContaining(['route_and_delegate', 'web_fetch']))
    expect(tools.filter(name => ABSENT_TOOLS.includes(name))).toEqual([])
  })

  it('captures the egress of the session: the gateway, and the refused fetch', () => {
    expect(requests).toHaveLength(2)
    expect(egress).toContainEqual({ kind: 'connect', host: '127.0.0.1', port: gatewayPort })
    expect(egress.map(attempt => attempt.host)).toContain(PROBE_HOST)
  })

  it('sends nothing to deepseek.com or deepseeksvc.com', () => {
    expect(egress.filter(attempt => DEEPSEEK_HOST.test(attempt.host))).toEqual([])
  })
})
