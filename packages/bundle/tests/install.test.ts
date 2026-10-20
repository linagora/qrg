/**
 * The installation procedure of the README: `pnpm qrg:install` creates the
 * `qrg` profile in the DSH home once and never touches a profile that
 * exists; `pnpm qrg` does not start dsh without it.
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const installScript = fileURLToPath(new URL('../src/install.ts', import.meta.url))
const launcherScript = fileURLToPath(new URL('../src/qrg.ts', import.meta.url))

interface Outcome {
  code: number
  stdout: string
  stderr: string
}

/**
 * Run one of the scripts on a DSH home.
 * @param script - the script path.
 * @param home - the DSH home.
 * @returns the exit code and output.
 */
async function runScript(script: string, home: string): Promise<Outcome> {
  const env = { ...process.env, DSH_HOME: home, LINAGORA_API_KEY: undefined }
  try {
    const { stdout, stderr } = await run(process.execPath, [script], { env })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const { code, stdout, stderr } = error as Outcome
    return { code, stdout, stderr }
  }
}

describe('the installation procedure', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'qrg-install-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('creates the qrg profile from the web template, plus the QRG bundle', async () => {
    const dir = join(home, 'profiles', 'qrg')
    expect(await runScript(installScript, home)).toEqual({ code: 0, stdout: `qrg-install: created the qrg profile at ${dir}\n`, stderr: '' })
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@linagora/qrg-bundle'])
  })

  it('leaves a profile that exists untouched', async () => {
    const dir = join(home, 'profiles', 'qrg')
    await runScript(installScript, home)
    await writeFile(join(dir, 'cordis.patch.yml'), '# rows of my own\n')
    const files = await readdir(dir)
    expect(await runScript(installScript, home)).toEqual({ code: 1, stdout: '', stderr: `qrg-install: the qrg profile already exists at ${dir}; nothing was changed\n` })
    expect(await readdir(dir)).toEqual(files)
    expect(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')).toBe('# rows of my own\n')
  })

  it('leaves a profile directory without manifest untouched, and nothing beside it', async () => {
    const dir = join(home, 'profiles', 'qrg')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'cordis.patch.yml'), '# rows of my own\n')
    expect(await runScript(installScript, home)).toEqual({ code: 1, stdout: '', stderr: `qrg-install: the qrg profile already exists at ${dir}; nothing was changed\n` })
    expect(await readdir(join(home, 'profiles'))).toEqual(['qrg'])
    expect(await readdir(dir)).toEqual(['cordis.patch.yml'])
  })

  it('does not start dsh without the profile', async () => {
    expect(await runScript(launcherScript, home)).toEqual({ code: 1, stdout: '', stderr: 'qrg: no qrg profile in the DSH home; create it with pnpm qrg:install\n' })
  })
})
