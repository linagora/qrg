/**
 * Egress capture of the composition tests, preloaded into the launched dsh
 * with `--import`, which Node also runs in the child processes and in the
 * workers started from a file. Every TCP connection and every host name
 * lookup leaves one JSON line in the file `QRG_EGRESS_LOG` names. Loopback
 * goes through; any other host is refused before a packet leaves, so a flow
 * the profile fails to cut shows in the log without reaching its host.
 *
 * It patches `node:net` and `node:dns` for the whole process: no test may
 * import it.
 */
import dns from 'node:dns'
import { appendFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import type { EgressAttempt } from './egress.ts'

const log = process.env['QRG_EGRESS_LOG']
if (log === undefined || log === '') throw new Error('egress-guard: QRG_EGRESS_LOG names no file')
// An empty log then proves the guard ran and saw nothing.
appendFileSync(log, '')

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|::ffff:127(\.\d{1,3}){3})$/i

function record(attempt: EgressAttempt): void {
  appendFileSync(log as string, `${JSON.stringify(attempt)}\n`)
}

function refusal(code: string, host: string): Error {
  return Object.assign(new Error(`${code} ${host}: refused by the QRG egress capture`), { code, hostname: host })
}

/**
 * The remote end of a `Socket.prototype.connect` call.
 * @param args - the call arguments; `net.connect` passes its normalized ones as one array.
 * @returns the host and port, or undefined for an IPC path.
 */
function connectTarget(args: unknown[]): EgressAttempt | undefined {
  const [first, second] = Array.isArray(args[0]) ? args[0] as unknown[] : args
  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: unknown, port?: unknown, path?: unknown }
    if (typeof options.path === 'string') return undefined
    const host = typeof options.host === 'string' ? options.host : 'localhost'
    return options.port === undefined ? { kind: 'connect', host } : { kind: 'connect', host, port: Number(options.port) }
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return { kind: 'connect', host: typeof second === 'string' ? second : 'localhost', port: Number(first) }
  }
  return undefined
}

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
  const target = connectTarget(args)
  if (target === undefined) return Reflect.apply(connect, this, args) as net.Socket
  record(target)
  if (LOOPBACK.test(target.host)) return Reflect.apply(connect, this, args) as net.Socket
  process.nextTick(() => this.destroy(refusal('ECONNREFUSED', target.host)))
  return this
} as typeof connect

const lookup = dns.lookup
dns.lookup = function (hostname: string, ...rest: unknown[]): void {
  record({ kind: 'lookup', host: hostname })
  if (LOOPBACK.test(hostname)) {
    Reflect.apply(lookup, dns, [hostname, ...rest])
    return
  }
  const callback = rest.at(-1)
  if (typeof callback === 'function') process.nextTick(callback, refusal('ENOTFOUND', hostname))
} as typeof lookup

const promisesLookup = dns.promises.lookup
dns.promises.lookup = async function (hostname: string, ...rest: unknown[]): Promise<unknown> {
  record({ kind: 'lookup', host: hostname })
  if (LOOPBACK.test(hostname)) return Reflect.apply(promisesLookup, dns.promises, [hostname, ...rest]) as unknown
  throw refusal('ENOTFOUND', hostname)
} as typeof promisesLookup

// Named imports such as `import { lookup } from 'node:dns/promises'` follow.
syncBuiltinESMExports()
