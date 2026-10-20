/**
 * `pnpm qrg:install`: create the `qrg` DSH profile in the DSH home dsh
 * resolves, `$DSH_HOME` or `~/.dsh`. A profile that exists stays untouched.
 * @module @linagora/qrg-bundle/install
 */
import { PROFILE_NAME, installProfile } from './profile.ts'

try {
  const dir = await installProfile()
  process.stdout.write(`qrg-install: created the ${PROFILE_NAME} profile at ${dir}\n`)
} catch (error) {
  process.stderr.write(`qrg-install: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
