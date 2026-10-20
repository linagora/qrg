/**
 * `pnpm qrg`: start dsh on the `qrg` profile, with DSH_TELEMETRY_DISABLED
 * set so that dsh disables the telemetry row after every patch layer, even
 * one that turned it back on. The arguments go to dsh, which works in the
 * caller's directory.
 * @module @linagora/qrg-bundle/qrg
 */
import { spawn } from 'node:child_process'
import { DSH_BIN, PROFILE_NAME, profileExists } from './profile.ts'

if (profileExists()) {
  const child = spawn(process.execPath, [DSH_BIN, '--profile', PROFILE_NAME, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
  })
  // The terminal sends Ctrl+C to dsh too, which shuts down on its own.
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => { child.kill('SIGTERM') })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} else {
  process.stderr.write(`qrg: no ${PROFILE_NAME} profile in the DSH home; create it with pnpm qrg:install\n`)
  process.exitCode = 1
}
