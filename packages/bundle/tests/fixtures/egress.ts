/**
 * Egress capture of a launched dsh: the environment that preloads
 * egress-guard.ts, and the reader of the log it writes.
 */
import { readFile } from 'node:fs/promises'

/** One outgoing connection or host name lookup, refused unless loopback. */
export interface EgressAttempt {
  kind: 'connect' | 'lookup'
  host: string
  port?: number
}

const guard = new URL('egress-guard.ts', import.meta.url).href

/**
 * Environment that preloads the egress capture into the launched dsh.
 * @param log - absolute path of the log the capture writes.
 * @returns the variables to give the launch; they replace NODE_OPTIONS.
 */
export function egressCaptureEnv(log: string): Record<string, string> {
  return { NODE_OPTIONS: `--import=${guard}`, QRG_EGRESS_LOG: log }
}

/**
 * Read what the capture saw.
 * @param log - the path given to {@link egressCaptureEnv}.
 * @returns the attempts, in order.
 * @throws when the log is missing: the capture did not run.
 */
export async function readEgressLog(log: string): Promise<EgressAttempt[]> {
  const text = await readFile(log, 'utf8')
  return text.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as EgressAttempt)
}
