/**
 * Fake LINAGORA AI Gateway: an OpenAI-compatible chat completions endpoint on
 * a local port. It records every request and answers each one with the next
 * reply of its script.
 *
 * Adapted from `packages/llm/llm-pi-ai/tests/mock-server.ts` of the DeepSeek
 * Harness, under the following license:
 *
 * MIT License
 *
 * Copyright (c) 2026 DeepSeek
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

/** The fields of a chat completions request the tests read. */
export interface ChatCompletionRequest {
  model: string
  messages: { role: string, content?: unknown }[]
  tools?: { function: { name: string } }[]
}

/** One request received by the fake gateway. */
export interface GatewayRequest {
  headers: IncomingHttpHeaders
  body: ChatCompletionRequest
}

/** One scripted answer: a server-sent event stream, or an HTTP error. */
export type GatewayReply = { events: string[] } | { status: number, body: string }

/** A running fake gateway. */
export interface FakeGateway {
  /** Base URL of the endpoint, for the route's `baseURL`. */
  url: string
  /** The requests received, in arrival order. */
  requests: GatewayRequest[]
  /** Stop listening and drop the open connections. */
  close(): Promise<void>
}

/** Answer to a request beyond the script: an error the client does not retry. */
const EXHAUSTED: GatewayReply = { status: 400, body: '{"error":{"message":"the fake gateway script is exhausted"}}' }
const USAGE = '"usage":{"prompt_tokens":3,"completion_tokens":1}'

/**
 * Script a reply that ends the turn with a text answer.
 * @param text - the answer.
 * @returns the reply.
 */
export function textReply(text: string): GatewayReply {
  return {
    events: [
      JSON.stringify({ choices: [{ delta: { role: 'assistant', content: text }, index: 0, finish_reason: null }] }),
      `{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],${USAGE}}`,
      '[DONE]',
    ],
  }
}

/**
 * Script a reply that calls one tool.
 * @param name - the tool name.
 * @param args - the call arguments.
 * @returns the reply.
 */
export function toolCallReply(name: string, args: object): GatewayReply {
  const call = { index: 0, id: `call_${randomUUID()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }
  return {
    events: [
      JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [call] }, index: 0, finish_reason: null }] }),
      `{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}],${USAGE}}`,
      '[DONE]',
    ],
  }
}

/**
 * Start a fake gateway on a free local port.
 * @param script - the replies, in the order of the requests they answer.
 * @returns the running gateway.
 */
export async function startFakeGateway(script: readonly GatewayReply[]): Promise<FakeGateway> {
  const replies = [...script]
  const requests: GatewayRequest[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatCompletionRequest
      requests.push({ headers: request.headers, body })
      const reply = replies.shift() ?? EXHAUSTED
      if ('status' in reply) {
        response.writeHead(reply.status, { 'content-type': 'application/json' })
        response.end(reply.body)
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(reply.events.map(event => `data: ${event}\n\n`).join(''))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the fake gateway has no port')
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>(resolve => {
      server.close(() => { resolve() })
      server.closeAllConnections()
    }),
  }
}
