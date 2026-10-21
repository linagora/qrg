/**
 * Real composition of `route_and_delegate`: the published dsh 0.2.1-alpha.4
 * boots the QRG profile with its LINAGORA route pointed at a fake gateway,
 * and a driver row runs scripted conversations through the session
 * controller the web client calls. One launch serves every case.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DriverReport, Step } from './fixtures/delegation-driver.ts'
import { startFakeGateway, textReply, toolCallReply } from './fixtures/fake-gateway.ts'
import type { FakeGateway, GatewayReply, GatewayRequest } from './fixtures/fake-gateway.ts'
import { LAUNCH_TEST_TIMEOUT_MS, launchQrgProfile } from './fixtures/launch.ts'

const driverPath = fileURLToPath(new URL('fixtures/delegation-driver.ts', import.meta.url))

/** A fake key, under a variable of its own: the route's real variable stays cleared. */
const GATEWAY_KEY_ENV = 'QRG_TEST_GATEWAY_KEY'
const GATEWAY_KEY = 'qrg-test-gateway-key'

/** A valid TaskDescriptor. */
const TASK = {
  intent: 'documentation',
  description: 'Document the export command in the README',
  scope: { paths: ['README.md'], language: 'markdown' },
  interactive: false,
}

/** A valid TaskDescriptor whose delegated agent the gateway refuses to serve. */
const FAILING_TASK = {
  intent: 'tests',
  description: 'Write the tests of the export command',
  interactive: false,
}

/** One conversation of the driver, with the gateway's answers to its requests. */
interface Conversation {
  name: string
  steps: Step[]
  replies: GatewayReply[]
}

/** Run in this order, each in a new session. */
const CONVERSATIONS: Conversation[] = [
  {
    name: 'refused',
    steps: [{ prompt: 'Document the billing module next door' }],
    replies: [
      toolCallReply('route_and_delegate', { ...TASK, scope: { paths: ['../billing/README.md'] } }),
      textReply('The task was refused.'),
    ],
  },
  {
    name: 'failed',
    steps: [{ prompt: 'Have the export command tested' }],
    replies: [
      toolCallReply('route_and_delegate', FAILING_TASK),
      { status: 400, body: '{"error":{"message":"refused by the fake gateway"}}' },
      textReply('The delegated agent failed.'),
    ],
  },
  {
    // Last: selecting a model also saves it as the default of later sessions.
    name: 'delegated',
    steps: [
      { prompt: 'Hello' },
      { selectModel: { provider: 'linagora', model: 'head-b' } },
      { prompt: 'Have the export command documented' },
    ],
    replies: [
      textReply('Hello.'),
      toolCallReply('route_and_delegate', TASK),
      textReply('The README documents the export command.'),
      textReply('Done.'),
    ],
  },
]

interface Run {
  report: DriverReport
  requests: GatewayRequest[]
}

let gateway: FakeGateway | undefined
let cwd: string | undefined
let run: Run

/**
 * The requests of one conversation, assuming each reply answered exactly one
 * request of it.
 * @param name - the conversation.
 * @returns its slice of the requests the gateway received.
 */
function requestsOf(name: string): GatewayRequest[] {
  let start = 0
  for (const conversation of CONVERSATIONS) {
    if (conversation.name === name) return run.requests.slice(start, start + conversation.replies.length)
    start += conversation.replies.length
  }
  throw new Error(`no conversation named ${name}`)
}

/**
 * The tool results a request carries back to the model.
 * @param request - a chat completions request.
 * @returns the content of its tool messages, in order.
 */
function toolResults(request: GatewayRequest | undefined): unknown[] {
  return (request?.body.messages ?? []).filter(message => message.role === 'tool').map(message => message.content)
}

describe('route_and_delegate in the real composition', () => {
  beforeAll(async () => {
    gateway = await startFakeGateway(CONVERSATIONS.flatMap(conversation => conversation.replies))
    cwd = await mkdtemp(join(tmpdir(), 'qrg-delegation-'))
    const output = join(cwd, 'report.json')
    const models = ['head-a', 'head-b', 'qwen3.8'].map(id => ({ id }))
    await launchQrgProfile({
      label: 'QRG delegation',
      cwd,
      overlay: [
        { id: 'llm-pi-ai', config: { providers: { linagora: { apiKeyEnv: GATEWAY_KEY_ENV, api: 'openai-completions', baseURL: gateway.url, models } } } },
        { id: 'agent-default-model', config: { provider: 'linagora', model: 'head-a' } },
        // Its first-prompt title request would race the scripted replies.
        { id: 'session-title-llm', disabled: true },
        {
          insert: [{
            id: 'qrg-delegation-driver',
            name: driverPath,
            config: { output, conversations: CONVERSATIONS.map(conversation => conversation.steps) },
          }],
        },
      ],
      env: { [GATEWAY_KEY_ENV]: GATEWAY_KEY },
    })
    run = { report: JSON.parse(await readFile(output, 'utf8')) as DriverReport, requests: gateway.requests }
  }, LAUNCH_TEST_TIMEOUT_MS)

  afterAll(async () => {
    await gateway?.close()
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true })
  })

  it('exposes route_and_delegate to the lead model', () => {
    const [first] = requestsOf('refused')
    expect(first?.body.tools?.map(tool => tool.function.name)).toContain('route_and_delegate')
  })

  it('refuses a TaskDescriptor whose scope leaves the workspace, without delegating', () => {
    const requests = requestsOf('refused')
    expect(requests.map(request => request.body.model)).toEqual(['head-a', 'head-a'])
    expect(toolResults(requests[1])).toEqual([expect.stringContaining('"scope.paths[0]" must stay in the workspace')])
  })

  it('reports a delegated agent that fails as a tool error', () => {
    const requests = requestsOf('failed')
    expect(requests.map(request => request.body.model)).toEqual(['head-a', 'qwen3.8', 'head-a'])
    expect(toolResults(requests[2])).toEqual([expect.stringMatching(/^Error: the delegated agent stopped with error/)])
  })

  it('runs the delegated agent on the decided model after the lead model changed (L-01)', () => {
    const requests = requestsOf('delegated')
    expect(requests.map(request => request.body.model)).toEqual(['head-a', 'head-b', 'qwen3.8', 'head-b'])
    expect(JSON.stringify(requests[2]?.body.messages)).toContain(TASK.description)
    expect(toolResults(requests[3])).toEqual(['The README documents the export command.'])
  })

  it('authenticates every gateway request with the key of the variable the route names', () => {
    const authorizations = run.requests.map(request => request.headers.authorization)
    expect(new Set(authorizations)).toEqual(new Set([`Bearer ${GATEWAY_KEY}`]))
  })

  it('records each delegation with its class, decision, child and outcome, without the task text', () => {
    const { children, registry } = run.report
    expect(children.map(child => child.stopReason)).toEqual(['error', 'completed'])
    // Outside a git repository, every scope is C3, which the default policy keeps on the gateway.
    const sensitivity = { class: 'C3', evidence: expect.objectContaining({ fellBack: true }) }
    const decision = {
      agent: 'native',
      provider: 'linagora',
      model: 'qwen3.8',
      couple: 'native/qwen3.8',
      decidedBy: 'fallback',
      options: ['native/qwen3.8'],
      allowRules: ['sensitive-stays-internal'],
    }
    expect(registry).toEqual([
      { task: { intent: 'tests', interactive: false }, sensitivity, decision, ignoredFields: [], childSessionId: children[0]?.id, outcome: 'error' },
      {
        task: { intent: 'documentation', scope: TASK.scope, interactive: false },
        sensitivity,
        decision,
        ignoredFields: [],
        childSessionId: children[1]?.id,
        outcome: 'completed',
      },
    ])
  })
})
