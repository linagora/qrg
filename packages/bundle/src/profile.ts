/**
 * The `qrg` DSH profile: the shipped `web` template, plus the QRG bundle
 * linked from this checkout, with profile.patch.yml as the profile's own
 * patch layer.
 * @module @linagora/qrg-bundle/profile
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  initProfile,
  readProfileManifest,
  resolveProfileDir,
  writeProfileManifest,
} from '@deepseek-ai/dsh-app-boot'

/** Name of the profile, as `dsh --profile` takes it. */
export const PROFILE_NAME = 'qrg'

/** Directory of the QRG bundle, which the profile links. */
export const BUNDLE_DIR = fileURLToPath(new URL('..', import.meta.url))

/** Entry point of the dsh this checkout pins. */
export const DSH_BIN = join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')

const BIN_NAME = 'qrg-install'

/**
 * Tell whether the DSH home holds the `qrg` profile, by the rule dsh
 * applies: a profile directory without its manifest does not exist.
 * @param home - the DSH home; defaults to the one dsh resolves, `$DSH_HOME`
 *   or `~/.dsh`.
 * @returns true when the profile manifest exists.
 */
export function profileExists(home?: string): boolean {
  return existsSync(join(resolveProfileDir(PROFILE_NAME, home), 'package.json'))
}

/**
 * Create the `qrg` profile the way `dsh plugin add` leaves one from the
 * `web` template, with the bundle linked instead of installed. The profile
 * is built aside and moved in place once complete, as dsh builds a profile
 * from a template: an interrupted install leaves no partial profile.
 * @param home - the DSH home; defaults to the one dsh resolves, `$DSH_HOME`
 *   or `~/.dsh`.
 * @returns the profile directory.
 * @throws when the profile exists already: it stays untouched.
 */
export async function installProfile(home?: string): Promise<string> {
  const dir = resolveProfileDir(PROFILE_NAME, home)
  const exists = (): Error => new Error(`the ${PROFILE_NAME} profile already exists at ${dir}; nothing was changed`)
  if (profileExists(home)) throw exists()
  const web = PROFILE_TEMPLATES['web']
  if (web === undefined) throw new Error('dsh ships no web profile template')
  const bundle = JSON.parse(await readFile(join(BUNDLE_DIR, 'package.json'), 'utf8')) as { name: string }
  await mkdir(dirname(dir), { recursive: true })
  const staging = await mkdtemp(join(dirname(dir), `.${PROFILE_NAME}.staging-`))
  try {
    // Under its final name, which the template derives the manifest name from.
    const fresh = join(staging, PROFILE_NAME)
    initProfile(fresh, [...web.bundles, bundle.name])
    const manifest = readProfileManifest(BIN_NAME, fresh)
    writeProfileManifest(fresh, { ...manifest, dependencies: { ...manifest.dependencies, [bundle.name]: `link:${BUNDLE_DIR}` } })
    await mkdir(join(fresh, 'node_modules', dirname(bundle.name)), { recursive: true })
    await symlink(BUNDLE_DIR, join(fresh, 'node_modules', bundle.name), 'dir')
    // Replaces the empty patch layer of the template.
    await copyFile(join(BUNDLE_DIR, 'profile.patch.yml'), join(fresh, PROFILE_PATCH_FILENAME))
    try {
      await rename(fresh, dir)
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException
      if (code === 'EEXIST' || code === 'ENOTEMPTY') throw exists()
      throw error
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return dir
}
