/**
 * The QRG pilot fixture: a git repository built from `pilot/tree`, the
 * reduced copy of claude-delegate, as a clone sees it, plus a trapped branch.
 * See pilot/README.md.
 */
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const TREE = fileURLToPath(new URL('pilot/tree', import.meta.url))
const SENSITIVITY_FILE = '.linagora/sensitivity.yml'

/** The canary of each zone above C0, in the zone's own module. */
export const PILOT_CANARIES = { C1: 'qrg-canary-c1-1c880187', C2: 'qrg-canary-c2-0f8e65d7', C3: 'qrg-canary-c3-80792e6b' } as const

/** The canary of the `.env` file the trapped branch tracks. */
export const TRAP_ENV_CANARY = 'qrg-canary-env-5d0c7a19'

/** SHA-256 of `pilot/tree/.linagora/sensitivity.yml`, to update with the file. */
export const PILOT_SENSITIVITY_SHA256 = '7ffa9ce0d89d949c66829bffacf6ae31b7da0a99471a8b639a94870d17cdd38f'

/** The branch of the trapped commit. */
export const TRAP_BRANCH = 'trap'

/**
 * Git without the user's or the system's configuration, hence without their
 * hooks or signing, and without the `GIT_` variables of the calling git, as
 * under `git rebase --exec`, which would point it at the calling repository.
 */
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'QRG fixture',
  GIT_AUTHOR_EMAIL: 'fixture@qrg.invalid',
  GIT_COMMITTER_NAME: 'QRG fixture',
  GIT_COMMITTER_EMAIL: 'fixture@qrg.invalid',
}

/**
 * Run git in a directory with the fixture's environment.
 * @param dir - where to run it.
 * @param args - the git arguments.
 * @returns its standard output.
 */
export async function runGit(dir: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd: dir, env: GIT_ENV })).stdout
}

/** A built pilot repository. */
export interface PilotRepo {
  /** Root of the repository, with `main` checked out. */
  root: string
  /**
   * Run git in the repository.
   * @param args - the git arguments.
   * @returns its standard output.
   */
  git(...args: string[]): Promise<string>
  /** Check out the trapped branch. */
  checkoutTrap(): Promise<void>
  /** Point the remote default branch at HEAD, as the merge of HEAD after review would. */
  mergeIntoDefault(): Promise<void>
  /**
   * Commit a submodule: a repository of its own, on its `main`, committed in
   * place as a gitlink, without `.gitmodules` nor remote.
   * @param path - where, relative to the root.
   * @param files - its files, by path relative to it.
   */
  addSubmodule(path: string, files: Record<string, string>): Promise<void>
  /**
   * Add paths to the index without writing them to the worktree, each a copy
   * of the root README. A path is raw bytes, so it may be a name that is not
   * UTF-8, which some filesystems refuse.
   * @param paths - the paths, relative to the root.
   */
  addToIndex(paths: Buffer[]): Promise<void>
}

/**
 * Build the pilot repository in an empty directory. `main` holds the pilot
 * tree and is the remote default branch: `refs/remotes/origin/main` points
 * at it and `refs/remotes/origin/HEAD` at that ref, with no remote to fetch
 * from. The trapped branch lowers the C3 zone to C0 and adds, in the C0
 * zone, a link to the C3 module, a link out of the repository and a tracked
 * `.env` file.
 * @param dir - the directory, which becomes the repository root.
 * @returns the repository.
 */
export async function buildPilotRepo(dir: string): Promise<PilotRepo> {
  const git = async (...args: string[]): Promise<string> => runGit(dir, ...args)
  await cp(TREE, dir, { recursive: true })
  await git('init', '-q', '-b', 'main')
  await git('add', '-A')
  await git('commit', '-q', '-m', 'Pilot tree')
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')

  await git('checkout', '-q', '-b', TRAP_BRANCH)
  const file = join(dir, SENSITIVITY_FILE)
  const lowered = (await readFile(file, 'utf8')).replace('  - id: pilot-secnumcloud\n    class: C3\n', '  - id: pilot-secnumcloud\n    class: C0\n')
  await writeFile(file, lowered)
  await symlink('../c3_secnumcloud/pseudonymize.py', join(dir, 'qrg_pilot/c0_public/shortcut.py'))
  await symlink('/etc/hosts', join(dir, 'qrg_pilot/c0_public/outside'))
  await writeFile(join(dir, 'qrg_pilot/c0_public/.env'), `QRG_FAKE_SECRET=${TRAP_ENV_CANARY}\n`)
  await git('add', '-A')
  await git('commit', '-q', '-m', 'Lower the C3 zone, link to it and out, track a secret')
  await git('checkout', '-q', 'main')

  return {
    root: dir,
    git,
    checkoutTrap: async () => { await git('checkout', '-q', TRAP_BRANCH) },
    mergeIntoDefault: async () => { await git('update-ref', 'refs/remotes/origin/main', 'HEAD') },
    addSubmodule: async (path, files) => {
      const sub = join(dir, path)
      for (const [file, content] of Object.entries(files)) {
        await mkdir(dirname(join(sub, file)), { recursive: true })
        await writeFile(join(sub, file), content)
      }
      for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'Library']]) await runGit(sub, ...args)
      await git('add', path)
      await git('commit', '-q', '-m', 'Add the library')
    },
    addToIndex: async paths => {
      const entry = Buffer.from(`100644 ${(await git('rev-parse', 'HEAD:README.md')).trim()}\t`)
      const update = run('git', ['update-index', '-z', '--index-info'], { cwd: dir, env: GIT_ENV })
      update.child.stdin?.end(Buffer.concat(paths.flatMap(path => [entry, path, Buffer.from([0])])))
      await update
    },
  }
}
