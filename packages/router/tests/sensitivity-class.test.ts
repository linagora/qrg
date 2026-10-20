/**
 * Class of a scope over the pilot repository (notes/lot0-sensibilite.md),
 * D-11 to D-15: two versions of the sensitivity file, built-in C3 patterns,
 * symbolic links and submodules, with the evidence of each computation.
 */
import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyScope } from '../src/sensitivity.ts'
import { PILOT_SENSITIVITY_SHA256, buildPilotRepo, runGit } from './fixtures/pilot.ts'
import type { PilotRepo } from './fixtures/pilot.ts'

const SENSITIVITY_FILE = '.linagora/sensitivity.yml'

/** A zone that covers the whole pilot package, C3 zone included. */
const WIDE_ZONE = '  - id: pilot-everything\n    class: C0\n    paths: ["qrg_pilot/**"]\n'

/** A sensitivity file that declares the whole repository C0. */
const ALL_PUBLIC = 'version: 1\ndefault: C0\n'

/** The link of the C0 zone to the C3 module, on the trapped branch. */
const SHORTCUT = 'qrg_pilot/c0_public/shortcut.py'

let repo: PilotRepo

beforeEach(async () => {
  repo = await buildPilotRepo(await mkdtemp(join(tmpdir(), 'qrg-pilot-')))
})

afterEach(async () => {
  await rm(repo.root, { recursive: true, force: true })
})

/**
 * Read the pilot's sensitivity file from the worktree.
 * @returns its text.
 */
async function readSensitivityFile(): Promise<string> {
  return readFile(join(repo.root, SENSITIVITY_FILE), 'utf8')
}

/**
 * Replace the pilot's sensitivity file and merge the change into the default branch.
 * @param text - the new file.
 */
async function mergeSensitivityFile(text: string): Promise<void> {
  await writeFile(join(repo.root, SENSITIVITY_FILE), text)
  await repo.git('commit', '-q', '-am', 'Change the sensitivity file')
  await repo.mergeIntoDefault()
}

describe('class of a scope', () => {
  it('classes a modified file of the C3 zone C3 (D-11)', async () => {
    await appendFile(join(repo.root, 'qrg_pilot/c3_secnumcloud/pseudonymize.py'), '# reviewed\n')
    expect((await classifyScope(repo.root, ['qrg_pilot/c3_secnumcloud/pseudonymize.py'])).class).toBe('C3')
  })

  it('classes a directory by every path under it', async () => {
    expect((await classifyScope(repo.root, ['qrg_pilot/c1_internal'])).class).toBe('C1')
    expect((await classifyScope(repo.root, ['README.md', 'qrg_pilot/'])).class).toBe('C3')
  })

  it('classes an empty scope as the whole repository', async () => {
    expect((await classifyScope(repo.root, [])).class).toBe('C3')
  })

  it('classes an untracked path the scope names along with the whole repository', async () => {
    await mergeSensitivityFile(ALL_PUBLIC)
    await writeFile(join(repo.root, '.env'), 'QRG_FAKE_SECRET=untracked\n')
    expect((await classifyScope(repo.root, ['.'])).class).toBe('C0')
    expect((await classifyScope(repo.root, ['.', '.env'])).class).toBe('C3')
  })

  it('classes the paths of HEAD that the index no longer lists', async () => {
    await repo.git('rm', '-r', '-q', '--cached', 'qrg_pilot/c3_secnumcloud')
    expect((await classifyScope(repo.root, [])).class).toBe('C3')
    expect((await classifyScope(repo.root, ['qrg_pilot'])).class).toBe('C3')
  })

  it.each([
    ['a directory name', 'qrg_pilot/c1_internal', 'qrg_pilot/c1_internal/changelog.py'],
    ['a final "**"', 'drafts/**', 'drafts'],
  ])('covers with %s the directory and every path under it', async (_label, pattern, path) => {
    await mergeSensitivityFile(`${ALL_PUBLIC}zones:\n  - id: restricted\n    class: C3\n    paths: ["${pattern}"]\n`)
    expect((await classifyScope(repo.root, [path])).class).toBe('C3')
  })

  it.each([
    ['alone', [Buffer.from('qrg_pilot/c0_public/café.py', 'latin1')]],
    ['beside the name it decodes to', [Buffer.from('qrg_pilot/c0_public/cafÿ.py', 'latin1'), Buffer.from('qrg_pilot/c0_public/caf�.py')]],
  ])('classes a tracked name that is not UTF-8 C3, %s', async (_label, names) => {
    await mergeSensitivityFile(ALL_PUBLIC)
    await repo.addToIndex(names)
    const undecodable = await classifyScope(repo.root, ['qrg_pilot/c0_public'])
    expect(undecodable.class).toBe('C3')
    expect(undecodable.evidence.undecodablePaths).toEqual(['qrg_pilot/c0_public/caf�.py'])
  })

  it('classes every tracked path a link to the root reaches, however many', async () => {
    await mergeSensitivityFile(ALL_PUBLIC)
    await repo.addToIndex(Array.from({ length: 150_000 }, (_, index) => Buffer.from(`bulk/f${index}.txt`)))
    await mkdir(join(repo.root, 'sub'))
    await symlink('..', join(repo.root, 'sub/up'))
    const reached = await classifyScope(repo.root, ['sub/up'])
    expect(reached.class).toBe('C0')
    expect(reached.evidence.files).toEqual([{ repository: '', trusted: { fingerprint: expect.any(String) }, worktree: { fingerprint: expect.any(String) } }])
  }, 60_000)

  it.each([
    ['twenty "**" segments', `${'**/'.repeat(20)}zzz`, `${Array.from({ length: 12 }, (_, index) => `d${index}`).join('/')}/f.txt`],
    ['thirteen "*" in a segment', `**/${'*a'.repeat(12)}*b`, `qrg_pilot/${'a'.repeat(64)}`],
  ])('matches a pattern of %s from the worktree without slowing down', async (_label, pattern, path) => {
    await appendFile(join(repo.root, SENSITIVITY_FILE), `\n  - id: deep\n    class: C1\n    paths: ["${pattern}"]\n`)
    const started = performance.now()
    const deep = await classifyScope(repo.root, [path])
    expect(performance.now() - started).toBeLessThan(2000)
    expect(deep.class).toBe('C0')
  })

  it('reads the scope relative to a workspace below the root', async () => {
    const workspace = join(repo.root, 'qrg_pilot')
    expect((await classifyScope(workspace, ['c1_internal'])).class).toBe('C1')
    expect((await classifyScope(workspace, ['c3_secnumcloud/pseudonymize.py'])).class).toBe('C3')
    expect((await classifyScope(join(workspace, 'c0_public'), [])).class).toBe('C3')
  })

  it('compares paths without case', async () => {
    expect((await classifyScope(repo.root, ['QRG_PILOT/C3_SECNUMCLOUD'])).class).toBe('C3')
    expect((await classifyScope(repo.root, ['Qrg_Pilot/C2_Client_Acme/invoice.py'])).class).toBe('C2')
  })

  it.each([
    ['a decomposed accent to a composed one', 'qrg_pilot/café/menu.py', 'qrg_pilot/café/**'],
    ['a composed accent to a decomposed one', 'qrg_pilot/café/menu.py', 'qrg_pilot/café/**'],
    ['a long s to an s', 'qrg_pilot/ſecrets/key.py', 'qrg_pilot/secrets/**'],
  ])('compares %s in the pattern of a zone', async (_label, path, pattern) => {
    await mergeSensitivityFile(`${ALL_PUBLIC}zones:\n  - id: restricted\n    class: C3\n    paths: ["${pattern}"]\n`)
    expect((await classifyScope(repo.root, [path])).class).toBe('C3')
  })

  it.each([
    ['before', (text: string) => text.replace('zones:\n', `zones:\n${WIDE_ZONE}`)],
    ['after', (text: string) => `${text}\n${WIDE_ZONE}`],
  ])('keeps a C3 zone inside a merged wide C0 zone declared %s it (D-14)', async (_place, declare) => {
    await mergeSensitivityFile(declare(await readSensitivityFile()))
    const nested = await classifyScope(repo.root, ['qrg_pilot/c3_secnumcloud/pseudonymize.py'])
    expect(nested.class).toBe('C3')
    expect(nested.evidence.zones).toEqual(['pilot-everything', 'pilot-secnumcloud'])
  })

  it('names the zones of the scope and their labels, and fingerprints both versions of the file', async () => {
    expect((await classifyScope(repo.root, ['qrg_pilot/c1_internal', 'qrg_pilot/c3_secnumcloud/pseudonymize.py', 'README.md'])).evidence).toEqual({
      zones: ['pilot-internal-tooling', 'pilot-secnumcloud'],
      labels: ['internal-tooling', 'personal-data', 'secnumcloud', 'secrets'],
      builtinPatterns: [],
      escapingLinks: [],
      undecodablePaths: [],
      files: [{ repository: '', trusted: { fingerprint: PILOT_SENSITIVITY_SHA256 }, worktree: { fingerprint: PILOT_SENSITIVITY_SHA256 } }],
      fellBack: false,
      raisedByWorktree: false,
      loweringIgnored: false,
    })
  })
})

describe('the two versions of the sensitivity file', () => {
  it('keeps a zone a branch lowers until the default branch changes, and records the attempt (D-12)', async () => {
    await repo.checkoutTrap()
    const lowered = await classifyScope(repo.root, ['qrg_pilot/c3_secnumcloud'])
    expect(lowered.class).toBe('C3')
    expect(lowered.evidence).toMatchObject({ raisedByWorktree: false, loweringIgnored: true })
    const [file] = lowered.evidence.files
    expect(file?.trusted.fingerprint).toBe(PILOT_SENSITIVITY_SHA256)
    expect(file?.worktree.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(file?.worktree.fingerprint).not.toBe(PILOT_SENSITIVITY_SHA256)

    await repo.mergeIntoDefault()
    const merged = await classifyScope(repo.root, ['qrg_pilot/c3_secnumcloud'])
    expect(merged.class).toBe('C0')
    expect(merged.evidence).toMatchObject({ raisedByWorktree: false, loweringIgnored: false })
  })

  it('applies at once a class the worktree raises', async () => {
    await writeFile(join(repo.root, SENSITIVITY_FILE), (await readSensitivityFile()).replace('  - id: pilot-public\n    class: C0\n', '  - id: pilot-public\n    class: C2\n'))
    const raised = await classifyScope(repo.root, ['qrg_pilot/c0_public'])
    expect(raised.class).toBe('C2')
    expect(raised.evidence).toMatchObject({ raisedByWorktree: true, loweringIgnored: false })
  })

  it('reads the remote main before a local main that no review has seen', async () => {
    await repo.git('symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
    await repo.checkoutTrap()
    await repo.git('branch', '-f', 'main', 'HEAD')
    expect((await classifyScope(repo.root, ['qrg_pilot/c3_secnumcloud'])).class).toBe('C3')
  })

  it('reads the local main when the remote has no default branch', async () => {
    await repo.git('symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
    await repo.git('update-ref', '-d', 'refs/remotes/origin/main')
    await repo.checkoutTrap()
    expect((await classifyScope(repo.root, ['qrg_pilot/c3_secnumcloud'])).class).toBe('C3')
  })

  it('records a worktree file merely deleted as a fallback, not as a raise', async () => {
    await rm(join(repo.root, SENSITIVITY_FILE))
    const deleted = await classifyScope(repo.root, ['README.md'])
    expect(deleted.class).toBe('C3')
    expect(deleted.evidence).toMatchObject({ fellBack: true, raisedByWorktree: false, loweringIgnored: false })
    expect(deleted.evidence.files[0]?.worktree).toEqual({ fingerprint: null, fallback: expect.stringContaining('absent') })
  })
})

describe('built-in C3 patterns', () => {
  it('keeps a tracked secret C3 even when a merged zone lowers it', async () => {
    await repo.checkoutTrap()
    await mergeSensitivityFile(`${await readSensitivityFile()}\n  - id: env-files\n    class: C0\n    paths: ["**/.env"]\n`)
    const secret = await classifyScope(repo.root, ['qrg_pilot/c0_public/.env'])
    expect(secret.class).toBe('C3')
    expect(secret.evidence).toMatchObject({ zones: ['env-files', 'pilot-public'], builtinPatterns: ['**/.env'] })
  })

  it.each([
    ['**/.env', '.env'],
    ['**/.env.local', 'config/.env.local'],
    ['**/.env.*.local', 'config/.env.production.local'],
    ['**/*.pem', 'certs/server.pem'],
    ['**/*.p12', 'certs/client.p12'],
    ['**/*.pfx', 'certs/client.pfx'],
    ['**/id_rsa', '.ssh/id_rsa'],
    ['**/id_ecdsa', '.ssh/id_ecdsa'],
    ['**/id_ed25519', '.ssh/id_ed25519'],
    ['**/.netrc', '.netrc'],
  ])('keeps "%s" C3 under a merged C0 zone that covers everything', async (pattern, path) => {
    await mergeSensitivityFile(`${ALL_PUBLIC}zones:\n  - id: everything\n    class: C0\n    paths: ["**"]\n`)
    const secret = await classifyScope(repo.root, [path])
    expect(secret.class).toBe('C3')
    expect(secret.evidence.builtinPatterns).toEqual([pattern])
  })
})

describe('symbolic links (D-15)', () => {
  it.each([
    ['in the worktree', async () => { await repo.checkoutTrap() }],
    ['deleted from the worktree', async () => {
      await repo.checkoutTrap()
      await rm(join(repo.root, SHORTCUT))
    }],
    ['replaced by a file in the worktree', async () => {
      await repo.checkoutTrap()
      await rm(join(repo.root, SHORTCUT))
      await writeFile(join(repo.root, SHORTCUT), 'VALUE = 1\n')
    }],
    ['only in HEAD', async () => {
      await repo.checkoutTrap()
      await repo.git('rm', '-q', SHORTCUT)
    }],
    ['only in the index', async () => {
      await symlink('../c3_secnumcloud/pseudonymize.py', join(repo.root, SHORTCUT))
      await repo.git('add', SHORTCUT)
      await rm(join(repo.root, SHORTCUT))
    }],
  ])('classes a link of the C0 zone by its target in the C3 zone, %s', async (_label, prepare) => {
    await prepare()
    const shortcut = await classifyScope(repo.root, [SHORTCUT])
    expect(shortcut.class).toBe('C3')
    expect(shortcut.evidence.zones).toEqual(['pilot-public', 'pilot-secnumcloud'])
  })

  it.each([
    ['in the worktree', false],
    ['deleted from the worktree', true],
  ])('classes a link out of the repository C3, %s', async (_label, deleted) => {
    await repo.checkoutTrap()
    if (deleted) await rm(join(repo.root, 'qrg_pilot/c0_public/outside'))
    const outside = await classifyScope(repo.root, ['qrg_pilot/c0_public/outside'])
    expect(outside.class).toBe('C3')
    expect(outside.evidence.escapingLinks).toEqual(['qrg_pilot/c0_public/outside'])
  })

  it.each([
    ['in the worktree', false],
    ['tracked, then deleted from the worktree', true],
  ])('classes a link to a C3 directory, and a path through it, C3, %s', async (_label, tracked) => {
    const vault = 'qrg_pilot/c0_public/vault'
    await symlink('../c3_secnumcloud', join(repo.root, vault))
    if (tracked) {
      await repo.git('add', vault)
      await rm(join(repo.root, vault))
    }
    expect((await classifyScope(repo.root, [vault])).class).toBe('C3')
    expect((await classifyScope(repo.root, [`${vault}/pseudonymize.py`])).class).toBe('C3')
  })

  it.each([
    ['in the worktree', false],
    ['tracked, then deleted from the worktree', true],
  ])('classes a loop of links C3, %s', async (_label, tracked) => {
    await symlink('loop/sub', join(repo.root, 'loop'))
    if (tracked) {
      await repo.git('add', 'loop')
      await rm(join(repo.root, 'loop'))
    }
    const loop = await classifyScope(repo.root, ['loop'])
    expect(loop.class).toBe('C3')
    expect(loop.evidence.escapingLinks).toHaveLength(1)
  })
})

describe('submodules', () => {
  it('classes a submodule without a sensitivity file C3', async () => {
    await repo.addSubmodule('vendor/lib', { 'lib.py': 'VALUE = 1\n' })
    const bare = await classifyScope(repo.root, ['vendor'])
    expect(bare.class).toBe('C3')
    expect(bare.evidence.files).toContainEqual({
      repository: 'vendor/lib',
      trusted: { fingerprint: null, fallback: expect.stringContaining('absent') },
      worktree: { fingerprint: null, fallback: expect.stringContaining('absent') },
    })
  })

  it('classes a submodule by its own file, under the zones of the repository', async () => {
    await repo.addSubmodule('vendor/lib', {
      [SENSITIVITY_FILE]: 'version: 1\ndefault: C0\nzones:\n  - id: lib-internal\n    class: C1\n    paths: ["internal/**"]\n',
      'lib.py': 'VALUE = 1\n',
      'internal/tool.py': 'VALUE = 2\n',
    })
    expect((await classifyScope(repo.root, ['vendor/lib/lib.py'])).class).toBe('C0')
    const own = await classifyScope(repo.root, ['vendor/lib'])
    expect(own.class).toBe('C1')
    expect(own.evidence.zones).toEqual(['vendor/lib:lib-internal'])

    await appendFile(join(repo.root, SENSITIVITY_FILE), '\n  - id: vendored\n    class: C2\n    paths: ["vendor/**"]\n')
    const outer = await classifyScope(repo.root, ['vendor/lib/lib.py'])
    expect(outer.class).toBe('C2')
    expect(outer.evidence.zones).toEqual(['vendored'])
  })

  it('classes a submodule that is not checked out C3', async () => {
    await repo.addSubmodule('vendor/lib', { [SENSITIVITY_FILE]: 'version: 1\ndefault: C0\n', 'lib.py': 'VALUE = 1\n' })
    await rm(join(repo.root, 'vendor/lib'), { recursive: true })
    await mkdir(join(repo.root, 'vendor/lib'))
    const absent = await classifyScope(repo.root, ['vendor/lib'])
    expect(absent.class).toBe('C3')
    expect(absent.evidence.files).toContainEqual({
      repository: 'vendor/lib',
      trusted: { fingerprint: null, fallback: expect.stringContaining('not checked out') },
      worktree: { fingerprint: null, fallback: expect.stringContaining('not checked out') },
    })
  })
})

describe('the repository of the workspace', () => {
  it('classes the workspace whatever repository GIT_DIR names', async () => {
    const lowered = await buildPilotRepo(await mkdtemp(join(tmpdir(), 'qrg-pilot-')))
    try {
      await lowered.checkoutTrap()
      await lowered.mergeIntoDefault()
      await repo.checkoutTrap()
      process.env.GIT_DIR = join(lowered.root, '.git')
      expect((await classifyScope(repo.root, ['qrg_pilot/c3_secnumcloud'])).class).toBe('C3')
    } finally {
      delete process.env.GIT_DIR
      await rm(lowered.root, { recursive: true, force: true })
    }
  })
})

describe('closing by default (D-13)', () => {
  it('sends the whole repository to C3 when the file is absent', async () => {
    await repo.git('rm', '-q', SENSITIVITY_FILE)
    await repo.git('commit', '-q', '-m', 'Remove the sensitivity file')
    await repo.mergeIntoDefault()
    const absent = await classifyScope(repo.root, ['README.md'])
    expect(absent.class).toBe('C3')
    expect(absent.evidence.fellBack).toBe(true)
    expect(absent.evidence.files).toEqual([{
      repository: '',
      trusted: { fingerprint: null, fallback: expect.stringContaining('absent') },
      worktree: { fingerprint: null, fallback: expect.stringContaining('absent') },
    }])
  })

  it('sends the whole repository to C3 when a version is invalid', async () => {
    await writeFile(join(repo.root, SENSITIVITY_FILE), (await readSensitivityFile()).replace('version: 1', 'version: 2'))
    const invalid = await classifyScope(repo.root, ['README.md'])
    expect(invalid.class).toBe('C3')
    expect(invalid.evidence.fellBack).toBe(true)
    expect(invalid.evidence.files[0]?.trusted).not.toHaveProperty('fallback')
    expect(invalid.evidence.files[0]?.worktree.fallback).toContain('version')
  })

  it('sends the whole repository to C3 when the index is unreadable', async () => {
    await writeFile(join(repo.root, '.git/index'), 'not an index')
    for (const scope of [[], ['README.md']]) {
      const unreadable = await classifyScope(repo.root, scope)
      expect(unreadable.class).toBe('C3')
      expect(unreadable.evidence.fellBack).toBe(true)
      expect(unreadable.evidence.files[0]?.fallback).toContain('index')
    }
  })

  it('sends the whole repository to C3 when HEAD names a missing commit', async () => {
    await writeFile(join(repo.root, '.git/refs/heads/main'), `${'1'.repeat(40)}\n`)
    const unreadable = await classifyScope(repo.root, ['README.md'])
    expect(unreadable.class).toBe('C3')
    expect(unreadable.evidence.files[0]?.fallback).toContain('HEAD')
  })

  it('sends a repository with neither commit nor file to C3, even for an empty scope', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'qrg-fresh-'))
    try {
      await runGit(fresh, 'init', '-q', '-b', 'main')
      expect((await classifyScope(fresh, [])).class).toBe('C3')
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })

  it('sends the whole repository to C3 without a default branch', async () => {
    await repo.git('symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
    await repo.git('update-ref', '-d', 'refs/remotes/origin/main')
    await repo.git('branch', '-q', '-m', 'main', 'develop')
    const orphan = await classifyScope(repo.root, ['README.md'])
    expect(orphan.class).toBe('C3')
    expect(orphan.evidence.files[0]?.trusted).toEqual({ fingerprint: null, fallback: expect.stringContaining('default branch') })
  })

  it('sends a directory outside any repository to C3', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'qrg-no-repo-'))
    try {
      const unknown = await classifyScope(outside, [])
      expect(unknown.class).toBe('C3')
      expect(unknown.evidence.fellBack).toBe(true)
      expect(unknown.evidence.files[0]?.worktree.fallback).toContain('git repository')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
