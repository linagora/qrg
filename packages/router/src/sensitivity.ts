/**
 * Sensitivity class of a set of paths, computed from the repository's
 * `.linagora/sensitivity.yml` as notes/lot0-sensibilite.md specifies it.
 * No model takes part in it.
 * @module @linagora/qrg-router/sensitivity
 */
import { isUtf8 } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readlink, realpath } from 'node:fs/promises'
import { isAbsolute, join, posix, relative } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { describeIssue, readYaml } from './yaml-file.ts'

const run = promisify(execFile)

/** Where the sensitivity file lives, relative to the repository root. */
const SENSITIVITY_FILE = '.linagora/sensitivity.yml'

/** The mode git gives a submodule in a listing: a commit of another repository, or gitlink. */
const GITLINK_MODE = '160000'

/** The mode git gives a symbolic link in a listing, its object holding the target. */
const LINK_MODE = '120000'

/**
 * How many symbolic links a walk follows one after another before it takes
 * the path for a loop of links, as Linux does after 40.
 */
const MAX_LINK_HOPS = 40

/**
 * Room for the output of git: the listing of a large repository outgrows
 * the default 1 MiB, and 256 MiB holds millions of paths.
 */
const MAX_GIT_OUTPUT = 1 << 28

/** Characters as compared without case, by character. */
const FOLDED = new Map<string, string>()

/** The case changes a character goes through to be compared without case. */
const CASE_CHANGES = [(text: string) => text.toLowerCase(), (text: string) => text.toUpperCase(), (text: string) => text.toLowerCase()]

/** Patterns of secrets, C3 in both versions whatever the sensitivity file says. */
const BUILTIN_C3 = [
  '**/.env', '**/.env.local', '**/.env.*.local', '**/*.pem', '**/*.p12', '**/*.pfx', '**/id_rsa', '**/id_ecdsa', '**/id_ed25519', '**/.netrc',
].map(source => ({ source, pattern: compilePattern(source) }))

/** The classes as the YAML files of qrg-router name them. */
export const SensitivityClass = z.enum(['C0', 'C1', 'C2', 'C3'])

/** Sensitivity class, from C0 public to C3 sensitive. */
export type SensitivityClass = z.infer<typeof SensitivityClass>

const SensitivityFileV1 = z.strictObject({
  version: z.literal(1),
  default: SensitivityClass,
  zones: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'zone ids are kebab-case'),
    class: SensitivityClass,
    paths: z.array(z.string().superRefine((pattern, ctx) => {
      try {
        compilePattern(pattern)
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message })
      }
    })).min(1),
    labels: z.array(z.string()).optional(),
    description: z.string().optional(),
  })).optional(),
}).superRefine((file, ctx) => {
  const ids = new Set<string>()
  file.zones?.forEach((zone, index) => {
    if (ids.has(zone.id)) ctx.addIssue({ code: 'custom', path: ['zones', index, 'id'], message: 'duplicate zone id' })
    ids.add(zone.id)
  })
})

/** A zone of the sensitivity file. */
export interface Zone {
  id: string
  class: SensitivityClass
  /** Patterns of the paths it covers, relative to the repository root. */
  paths: string[]
  labels: string[]
}

/** The content of a valid sensitivity file. */
export interface SensitivityFile {
  /** Class of every path no zone covers. */
  default: SensitivityClass
  zones: Zone[]
}

/**
 * Read a sensitivity file, format version 1.
 * @param text - the file's text.
 * @returns its default class and zones.
 * @throws Error naming why the file is refused.
 */
export function parseSensitivityFile(text: string): SensitivityFile {
  const result = SensitivityFileV1.safeParse(readYaml(text))
  if (!result.success) throw new Error(result.error.issues.map(describeIssue).join('; '))
  const file = result.data
  return {
    default: file.default,
    zones: (file.zones ?? []).map(zone => ({ id: zone.id, class: zone.class, paths: zone.paths, labels: zone.labels ?? [] })),
  }
}

/** The class of a scope, and what it was computed from, without file content. */
export interface ScopeClass {
  class: SensitivityClass
  evidence: SensitivityEvidence
}

/** What a class was computed from. */
export interface SensitivityEvidence {
  /**
   * Ids of the zones that cover a path of the scope in either version,
   * sorted, a submodule's prefixed with its path (`vendor/lib:zone`).
   */
  zones: string[]
  /** Labels of those zones, sorted. */
  labels: string[]
  /** The built-in C3 patterns that cover a path of the scope, in their order. */
  builtinPatterns: string[]
  /**
   * Paths of the scope that leave the repository through a symbolic link of
   * the worktree or of git, sorted: by `..`, by an absolute target, by a
   * target that is not UTF-8, or by a loop of links.
   */
  escapingLinks: string[]
  /**
   * Tracked paths of the scope whose name is not UTF-8, decoded with
   * replacement characters, sorted: C3, as their links cannot be followed.
   */
  undecodablePaths: string[]
  /** The sensitivity file of the repository, then of each submodule the scope reaches. */
  files: FileEvidence[]
  /**
   * A repository the scope reaches counts C3 as a whole, whatever its zones:
   * a version of its file is absent, unreadable or invalid, or its paths
   * cannot be listed. `files` gives the reason.
   */
  fellBack: boolean
  /** With both versions read, the worktree's gives a path of the scope a higher class than the default branch's. */
  raisedByWorktree: boolean
  /** With both versions read, the worktree's gives a path of the scope a lower class, which is ignored until merged. */
  loweringIgnored: boolean
}

/** The two versions of a repository's sensitivity file. */
export interface FileEvidence {
  /** The repository the file belongs to: `''` for the root repository. */
  repository: string
  /** The version of the default branch, the only one that can lower a class. */
  trusted: VersionEvidence
  /** The version of the worktree, which can only raise a class. */
  worktree: VersionEvidence
  /** Why the whole repository counts as C3 whatever its file says, as when its index cannot be read. */
  fallback?: string
}

/** One version of a sensitivity file. */
export interface VersionEvidence {
  /** SHA-256 of the file's bytes, or null when there is no file to read. */
  fingerprint: string | null
  /** Why this version counts as C3 for the whole repository: file absent, unreadable or invalid. */
  fallback?: string
}

/** A pattern by segment: null for `**`, else the segment's folded characters, where `*` and `?` are wildcards. */
type Pattern = readonly (readonly string[] | null)[]

/** A path by segment, each segment's characters folded. */
type FoldedPath = readonly (readonly string[])[]

/** A zone of a version, its patterns compiled. */
interface CompiledZone {
  id: string
  class: SensitivityClass
  labels: string[]
  patterns: Pattern[]
}

/** What a version of the file says, when it is valid. */
interface Rules {
  default: SensitivityClass
  zones: CompiledZone[]
}

/** A version of the sensitivity file as read, without rules when it falls back to C3. */
interface Version {
  rules: Rules | undefined
  evidence: VersionEvidence
}

/** The two versions of a repository's sensitivity file. */
interface Versions {
  trusted: Version
  worktree: Version
}

/** What the classification of a scope gathers over a repository and its submodules. */
interface Tally {
  class: SensitivityClass
  zones: Set<string>
  labels: Set<string>
  builtins: Set<string>
  escapingLinks: Set<string>
  undecodablePaths: Set<string>
  files: FileEvidence[]
  raisedByWorktree: boolean
  loweringIgnored: boolean
}

/** The tracked paths of a repository: those of its index and of its HEAD commit. */
interface Tracked {
  /** The tree a scope entry expands in. */
  tree: TrackedNode
  /** Its submodules, with their folded path. */
  gitlinks: { path: string, folded: string }[]
  /**
   * Its symbolic links, by folded path, with the targets git holds for each
   * in the index and in HEAD: undefined for a target that is not UTF-8.
   */
  links: Map<string, (string | undefined)[]>
  /** The paths whose name is not UTF-8, as decoded. */
  undecodable: Set<string>
}

/** Real paths relative to the real root, by path relative to the root, as one walk resolves them. */
type RealPaths = Map<string, Promise<string | undefined>>

/** A directory or file of the tree of tracked paths, named by its folded path. */
interface TrackedNode {
  /** The tracked paths with this folded path: one, or a few that differ in case. */
  paths: string[]
  children: Map<string, TrackedNode>
  /** A scope entry reached it, hence everything under it. */
  reached: boolean
}

/** A condition that sends a whole repository to C3, its message the reason the evidence gives. */
class Fallback extends Error {}

/**
 * Compute the class of a scope: for every path, the highest of the classes
 * the default branch's version of the sensitivity file and the worktree's
 * version give it, and of the scope's paths, the highest. A path that is or
 * goes through a symbolic link adds the paths it leads to; a path of a
 * submodule is classified by the submodule's file as well.
 * @param workspace - a directory of the repository.
 * @param paths - the scope, relative to the workspace; empty for the whole repository.
 * @returns the class, and what it was computed from.
 */
export async function classifyScope(workspace: string, paths: readonly string[]): Promise<ScopeClass> {
  const tally: Tally = {
    class: 'C0',
    zones: new Set(),
    labels: new Set(),
    builtins: new Set(),
    escapingLinks: new Set(),
    undecodablePaths: new Set(),
    files: [],
    raisedByWorktree: false,
    loweringIgnored: false,
  }
  const root = await gitText(workspace, 'rev-parse', '--show-toplevel')
  if (root === undefined) {
    closeRepository(tally, '', 'not in a git repository')
  } else {
    const prefix = await gitText(workspace, 'rev-parse', '--show-prefix') ?? ''
    const entries = paths.length === 0 ? ['.'] : paths.map(path => normalizeEntry(posix.join(prefix, path)))
    await classifyRepository(root, '', entries, tally)
  }
  return {
    class: tally.class,
    evidence: {
      zones: [...tally.zones].sort(),
      labels: [...tally.labels].sort(),
      builtinPatterns: BUILTIN_C3.map(builtin => builtin.source).filter(source => tally.builtins.has(source)),
      escapingLinks: [...tally.escapingLinks].sort(),
      undecodablePaths: [...tally.undecodablePaths].sort(),
      files: tally.files,
      fellBack: tally.files.some(file => file.fallback !== undefined || file.trusted.fallback !== undefined || file.worktree.fallback !== undefined),
      raisedByWorktree: tally.raisedByWorktree,
      loweringIgnored: tally.loweringIgnored,
    },
  }
}

/**
 * Normalize a path relative to a repository root, without a final `/`.
 * @param path - the path.
 * @returns the normalized path, `.` for the root.
 */
function normalizeEntry(path: string): string {
  return posix.normalize(path).replace(/\/+$/, '') || '.'
}

/**
 * Tell whether a path, relative to a repository root, leaves the repository.
 * @param path - a normalized path.
 * @returns true for an absolute path or a path that starts with `..`.
 */
function leavesRoot(path: string): boolean {
  return path === '..' || path.startsWith('../') || isAbsolute(path)
}

/**
 * Count as C3 a repository whose sensitivity file cannot be read at all.
 * @param tally - what the classification gathers.
 * @param repository - the repository's path in the root repository.
 * @param reason - why, which both versions give.
 */
function closeRepository(tally: Tally, repository: string, reason: string): void {
  const absent = fallback(reason).evidence
  tally.files.push({ repository, trusted: absent, worktree: absent })
  tally.class = 'C3'
}

/**
 * Classify paths of a repository, each by both versions of its sensitivity
 * file, and those of its submodules by the submodule's file too. A version
 * that falls back counts C3 for the whole repository, whatever paths the
 * scope reaches, and so does a failure to list or follow them.
 * @param root - the repository root.
 * @param repository - its path in the root repository, `''` for the root repository.
 * @param entries - normalized entries relative to the root, `.` for the whole repository.
 * @param tally - what the classification gathers.
 * @returns the paths classified, relative to the root.
 */
async function classifyRepository(root: string, repository: string, entries: string[], tally: Tally): Promise<string[]> {
  const versions: Versions = { trusted: await readTrusted(root), worktree: await readWorktree(root) }
  const record: FileEvidence = { repository, trusted: versions.trusted.evidence, worktree: versions.worktree.evidence }
  tally.files.push(record)
  if (versions.trusted.rules === undefined || versions.worktree.rules === undefined) tally.class = 'C3'
  try {
    return await walkScope(root, repository, entries, versions, tally)
  } catch (error) {
    // Only the reasons this module writes reach the evidence: another error's message may quote a path or worse.
    const name = error instanceof Error ? error.name : 'unknown error'
    record.fallback = error instanceof Fallback ? error.message : `paths not classified (${name})`
    tally.class = 'C3'
    return []
  }
}

/**
 * Classify the paths a scope reaches in a repository: its entries, the
 * tracked paths they name or contain, the paths their symbolic links lead
 * to, in the worktree and as git records them, and through its submodules,
 * theirs.
 * @param root - the repository root.
 * @param repository - its path in the root repository.
 * @param entries - normalized entries relative to the root, `.` for the whole repository.
 * @param versions - its sensitivity file.
 * @param tally - what the classification gathers.
 * @returns the paths classified, relative to the root.
 * @throws Fallback when the tracked paths cannot be listed.
 */
async function walkScope(root: string, repository: string, entries: string[], versions: Versions, tally: Tally): Promise<string[]> {
  const realRoot = await realpath(root)
  const reals: RealPaths = new Map()
  const tracked = await listTracked(root)
  const submodules = new Map<string, string[]>()
  const seen = new Set<string>()
  // Each path is scored once per walk, however many entries, links or submodule paths reach it.
  const scoreOnce = (path: string): boolean => {
    if (seen.has(path)) return false
    seen.add(path)
    score(tally, repository, versions, path)
    return true
  }
  let round = reach(tracked, entries)
  for (let hops = 0; round.length > 0; hops++) {
    const fresh: string[] = []
    for (const path of round) {
      if (!scoreOnce(path)) continue
      const gitlink = submoduleOf(path, tracked)
      if (gitlink !== undefined) {
        const inner = submodules.get(gitlink) ?? []
        inner.push(path.split('/').slice(gitlink.split('/').length).join('/') || '.')
        submodules.set(gitlink, inner)
      }
      if (tracked.undecodable.has(path)) {
        tally.class = 'C3'
        tally.undecodablePaths.add(posix.join(repository, path))
      } else {
        fresh.push(path)
      }
    }
    round = []
    const resolved = await Promise.all(fresh.map(async path => ({ path, targets: await linkTargets(root, realRoot, reals, path) })))
    for (const { path, targets } of resolved) {
      const recorded = recordedTargets(tracked, path)
      // Still led elsewhere after MAX_LINK_HOPS links one after another, the path goes round a loop of links.
      if (targets === undefined || recorded === undefined || (hops === MAX_LINK_HOPS && targets.length + recorded.length > 0)) {
        tally.class = 'C3'
        tally.escapingLinks.add(posix.join(repository, path))
      } else {
        for (const target of reach(tracked, [...targets, ...recorded])) round.push(target)
      }
    }
  }
  for (const [gitlink, inner] of submodules) {
    const submodule = join(root, gitlink)
    if (!(await isRepositoryRoot(submodule))) {
      closeRepository(tally, posix.join(repository, gitlink), 'submodule not checked out')
      continue
    }
    for (const path of await classifyRepository(submodule, posix.join(repository, gitlink), inner, tally)) scoreOnce(`${gitlink}/${path}`)
  }
  return [...seen]
}

/**
 * Add to the tally the class both versions of a repository's sensitivity
 * file and the built-in patterns give a path.
 * @param tally - what the classification gathers.
 * @param repository - the repository's path in the root repository.
 * @param versions - its sensitivity file.
 * @param path - a path relative to its root.
 */
function score(tally: Tally, repository: string, versions: Versions, path: string): void {
  const folded = path.split('/').map(foldChars)
  const secrets = BUILTIN_C3.filter(builtin => covers(builtin.pattern, folded))
  for (const builtin of secrets) tally.builtins.add(builtin.source)
  const floor: SensitivityClass = secrets.length > 0 ? 'C3' : 'C0'
  tally.class = highest(tally.class, floor)
  const [trusted, worktree] = [versions.trusted, versions.worktree].map(version => {
    if (version.rules === undefined) return undefined
    const covering = match(version.rules, folded)
    for (const zone of covering.zones) {
      tally.zones.add(repository === '' ? zone.id : `${repository}:${zone.id}`)
      for (const label of zone.labels) tally.labels.add(label)
    }
    const pathClass = highest(floor, covering.class)
    tally.class = highest(tally.class, pathClass)
    return pathClass
  })
  // A version that falls back already counts C3 for the whole repository: neither a raise nor a lowering.
  if (trusted === undefined || worktree === undefined) return
  if (rank(worktree) > rank(trusted)) tally.raisedByWorktree = true
  if (rank(worktree) < rank(trusted)) tally.loweringIgnored = true
}

/**
 * List the tracked paths of a repository, from its index and its HEAD
 * commit: a path removed from the index but still in HEAD stays classified.
 * @param root - the repository root.
 * @returns the paths, as a tree by folded path, its submodules and its
 *   symbolic links.
 * @throws Fallback when the index, HEAD or a link cannot be read.
 */
async function listTracked(root: string): Promise<Tracked> {
  const index = await git(root, ['ls-files', '--stage', '-z'])
  if (index === undefined) throw new Fallback('index unreadable')
  // Without HEAD, as on a branch with no commit yet, the index lists every
  // tracked path. A HEAD that names a missing commit is unreadable.
  const hasHead = await git(root, ['rev-parse', '--verify', '-q', 'HEAD']) !== undefined
  const head = hasHead ? await git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']) : Buffer.alloc(0)
  if (head === undefined) throw new Fallback('HEAD unreadable')
  const tracked: Tracked = { tree: trackedNode(), gitlinks: [], links: new Map(), undecodable: new Set() }
  const linkObjects = new Map<string, Set<string>>()
  const listed = new Set<string>()
  for (const output of [index, head]) {
    for (const record of splitRecords(output)) {
      // `ls-files --stage` gives `mode object stage<TAB>path`, `ls-tree` gives `mode type object<TAB>path`.
      const tab = record.indexOf('\t')
      const [mode, second, third] = record.subarray(0, tab).toString('utf8').split(' ')
      const object = output === index ? second : third
      const name = record.subarray(tab + 1)
      const path = name.toString('utf8')
      // Before the paths are deduplicated: a name that is not UTF-8 may decode to the path of another name.
      if (!isUtf8(name)) tracked.undecodable.add(path)
      if (mode === GITLINK_MODE && !tracked.gitlinks.some(known => known.path === path)) tracked.gitlinks.push({ path, folded: foldPath(path) })
      if (mode === LINK_MODE && object !== undefined) {
        const folded = foldPath(path)
        linkObjects.set(folded, (linkObjects.get(folded) ?? new Set()).add(object))
      }
      if (listed.has(path)) continue
      listed.add(path)
      let node = tracked.tree
      for (const segment of foldPath(path).split('/')) {
        let child = node.children.get(segment)
        if (child === undefined) {
          child = trackedNode()
          node.children.set(segment, child)
        }
        node = child
      }
      node.paths.push(path)
    }
  }
  tracked.links = await readLinks(root, linkObjects)
  return tracked
}

/**
 * Make an empty node of the tree of tracked paths.
 * @returns the node.
 */
function trackedNode(): TrackedNode {
  return { paths: [], children: new Map(), reached: false }
}

/**
 * Read the targets of the symbolic links git records, in one run of
 * `git cat-file --batch`.
 * @param root - the repository root.
 * @param links - the objects of each link, by folded path.
 * @returns the targets of each link, by folded path: undefined for a target
 *   that is not UTF-8.
 * @throws Fallback when an object cannot be read.
 */
async function readLinks(root: string, links: Map<string, Set<string>>): Promise<Map<string, (string | undefined)[]>> {
  const objects = [...new Set([...links.values()].flatMap(set => [...set]))]
  const targets = new Map<string, string | undefined>()
  if (objects.length > 0) {
    const output = await git(root, ['cat-file', '--batch'], objects.map(object => `${object}\n`).join(''))
    if (output === undefined) throw new Fallback('link targets unreadable')
    // Each object comes back as `object type size<LF>content<LF>`, or `object missing<LF>`.
    let at = 0
    for (const object of objects) {
      const end = output.indexOf('\n', at)
      const [name, type, size] = output.subarray(at, Math.max(end, at)).toString('utf8').split(' ')
      if (name !== object || type !== 'blob') throw new Fallback('link targets unreadable')
      const target = output.subarray(end + 1, end + 1 + Number(size))
      targets.set(object, isUtf8(target) ? target.toString('utf8') : undefined)
      at = end + 1 + Number(size) + 1
    }
  }
  return new Map([...links].map(([folded, set]) => [folded, [...set].map(object => targets.get(object))]))
}

/**
 * Split the output of a git listing run with `-z`.
 * @param output - the output.
 * @returns its records, without their terminating NUL.
 */
function splitRecords(output: Buffer): Buffer[] {
  const records: Buffer[] = []
  for (let start = 0; start < output.length;) {
    const end = output.indexOf(0, start)
    const stop = end === -1 ? output.length : end
    if (stop > start) records.push(output.subarray(start, stop))
    start = stop + 1
  }
  return records
}

/**
 * List the paths a scope's entries reach: each entry, and the tracked paths
 * that are it or lie under it, compared without case, every tracked path for `.`.
 * A part of the tree is listed once per walk, however many entries reach it.
 * @param tracked - the tracked paths.
 * @param entries - normalized entries, relative to the repository root.
 * @returns the paths to classify.
 */
function reach(tracked: Tracked, entries: string[]): string[] {
  const paths: string[] = []
  for (const entry of entries) {
    let node: TrackedNode | undefined = tracked.tree
    if (entry !== '.') {
      paths.push(entry)
      for (const segment of foldPath(entry).split('/')) node = node?.children.get(segment)
    }
    const pending = node === undefined ? [] : [node]
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (next.reached) continue
      next.reached = true
      for (const path of next.paths) paths.push(path)
      for (const child of next.children.values()) pending.push(child)
    }
  }
  return paths
}

/**
 * Find the submodule a path is or lies in, compared without case.
 * @param path - a path relative to the repository root.
 * @param tracked - the tracked paths of the repository.
 * @returns the submodule's path, or undefined.
 */
function submoduleOf(path: string, tracked: Tracked): string | undefined {
  if (tracked.gitlinks.length === 0) return undefined
  const folded = foldPath(path)
  return tracked.gitlinks.find(gitlink => folded === gitlink.folded || folded.startsWith(`${gitlink.folded}/`))?.path
}

/**
 * Tell whether a directory is the root of a repository of its own, as a
 * checked-out submodule is.
 * @param dir - the directory.
 * @returns true when git finds the repository's root there.
 */
async function isRepositoryRoot(dir: string): Promise<boolean> {
  const top = await gitText(dir, 'rev-parse', '--show-toplevel')
  try {
    return top !== undefined && await realpath(top) === await realpath(dir)
  } catch {
    return false
  }
}

/**
 * Find where a path of the repository leads through the symbolic links of
 * the worktree: the target its own link names, and its real path once every
 * link is resolved.
 * @param root - the repository root.
 * @param realRoot - the root, its links resolved.
 * @param reals - the real paths the walk has resolved.
 * @param path - a normalized path relative to the root.
 * @returns the paths it leads to other than itself, relative to the root, or
 *   undefined when it leaves the repository, its link is absolute or a loop
 *   of links stops its resolution.
 */
async function linkTargets(root: string, realRoot: string, reals: RealPaths, path: string): Promise<string[] | undefined> {
  let isLink = false
  try {
    isLink = (await lstat(join(root, path))).isSymbolicLink()
  } catch (error) {
    if (!MISSING.has(errorCode(error))) return undefined
  }
  const targets: string[] = []
  let real: string | undefined
  if (isLink) {
    let link: string
    try {
      link = await readlink(join(root, path))
    } catch {
      return undefined
    }
    if (isAbsolute(link)) return undefined
    targets.push(normalizeEntry(posix.join(posix.dirname(path), link)))
    real = await realPath(root, realRoot, reals, path)
  } else {
    // Not a link, or absent: its real path is its parent's, followed by its name.
    real = await realPathUnderParent(root, realRoot, reals, path)
  }
  if (real === undefined) return undefined
  targets.push(real)
  if (targets.some(leavesRoot)) return undefined
  return targets.filter(target => target !== path)
}

/**
 * Find where the symbolic links git records lead a path: the link it is, and
 * the links its ancestors are, to the targets of the index and of HEAD,
 * whatever the worktree now holds in their place.
 * @param tracked - the tracked paths of the repository.
 * @param path - a normalized path relative to the root.
 * @returns the paths it leads to other than itself, relative to the root, or
 *   undefined when one of these links leaves the repository, its target is
 *   absolute or its target is not UTF-8.
 */
function recordedTargets(tracked: Tracked, path: string): string[] | undefined {
  if (tracked.links.size === 0) return []
  const segments = path.split('/')
  const folded = foldPath(path).split('/')
  const targets: string[] = []
  for (let end = 1; end <= segments.length; end++) {
    const link = segments.slice(0, end).join('/')
    for (const target of tracked.links.get(folded.slice(0, end).join('/')) ?? []) {
      if (target === undefined || isAbsolute(target)) return undefined
      const reached = normalizeEntry(posix.join(posix.dirname(link), target, ...segments.slice(end)))
      if (leavesRoot(reached)) return undefined
      targets.push(reached)
    }
  }
  return targets.filter(target => target !== path)
}

/** Codes of a path that does not exist, or whose parent is not a directory. */
const MISSING = new Set(['ENOENT', 'ENOTDIR'])

/**
 * Look up the real path of a path of the repository: its deepest existing
 * ancestor, links resolved, followed by the rest of the path. A walk
 * resolves each path once, however many of its paths share a directory.
 * @param root - the repository root.
 * @param realRoot - the root, its links resolved.
 * @param reals - the real paths the walk has resolved.
 * @param path - a normalized path relative to the root.
 * @returns the real path relative to the real root, or undefined when it
 *   cannot be resolved, as on a loop of links.
 */
function realPath(root: string, realRoot: string, reals: RealPaths, path: string): Promise<string | undefined> {
  let real = reals.get(path)
  if (real === undefined) {
    real = resolveRealPath(root, realRoot, reals, path)
    reals.set(path, real)
  }
  return real
}

/**
 * Resolve the real path of a path of the repository, for {@link realPath}.
 * @param root - the repository root.
 * @param realRoot - the root, its links resolved.
 * @param reals - the real paths the walk has resolved.
 * @param path - a normalized path relative to the root.
 * @returns the real path relative to the real root, or undefined.
 */
async function resolveRealPath(root: string, realRoot: string, reals: RealPaths, path: string): Promise<string | undefined> {
  try {
    return relative(realRoot, await realpath(join(root, path))) || '.'
  } catch (error) {
    if (!MISSING.has(errorCode(error)) || path === '.') return undefined
    return realPathUnderParent(root, realRoot, reals, path)
  }
}

/**
 * Look up the real path of a path of the repository as its parent's real
 * path followed by its name, for a path that is no link or does not exist.
 * @param root - the repository root.
 * @param realRoot - the root, its links resolved.
 * @param reals - the real paths the walk has resolved.
 * @param path - a normalized path relative to the root, other than `.`.
 * @returns the real path relative to the real root, or undefined when its
 *   parent's cannot be resolved.
 */
async function realPathUnderParent(root: string, realRoot: string, reals: RealPaths, path: string): Promise<string | undefined> {
  const parent = await realPath(root, realRoot, reals, posix.dirname(path))
  return parent === undefined ? undefined : posix.join(parent, posix.basename(path))
}

/**
 * Get the code of a filesystem error.
 * @param error - the error.
 * @returns its code, or `''` when it has none.
 */
function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? ''
}

/**
 * Run git, which reads the repository only. The `GIT_` variables of the
 * process are left out: `GIT_DIR` and the like would make git read another
 * repository than the one of `cwd`.
 * @param cwd - where to run it.
 * @param args - the git arguments.
 * @param input - what git reads on its standard input.
 * @returns its standard output, or undefined when it fails, as on a missing ref.
 */
async function git(cwd: string, args: readonly string[], input = ''): Promise<Buffer | undefined> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  try {
    // Off: core.fsmonitor, which the repository's configuration may set, makes git run a program or start a daemon as it reads the index.
    const running = run('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, env, encoding: 'buffer', maxBuffer: MAX_GIT_OUTPUT })
    // A git that stops before reading all its input breaks the pipe: the run fails, the write must not throw.
    running.child.stdin?.on('error', () => undefined).end(input)
    return (await running).stdout
  } catch {
    return undefined
  }
}

/**
 * Run git for a line of text, such as a path or an object id.
 * @param cwd - where to run it.
 * @param args - the git arguments.
 * @returns its standard output, trimmed, or undefined when it fails.
 */
async function gitText(cwd: string, ...args: string[]): Promise<string | undefined> {
  return (await git(cwd, args))?.toString('utf8').trim()
}

/**
 * Read the sensitivity file of the default branch: the one origin/HEAD
 * names, else the remote's `main` or `master`, else the local ones. A remote
 * branch comes first, as a local branch takes commits no review has seen.
 * @param root - the repository root.
 * @returns the version.
 */
async function readTrusted(root: string): Promise<Version> {
  const remote = await gitText(root, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD')
  let branch: string | undefined
  for (const ref of [...(remote === undefined ? [] : [remote]), ...DEFAULT_BRANCHES]) {
    if (await gitText(root, 'rev-parse', '--verify', '-q', `${ref}^{commit}`) !== undefined) {
      branch = ref
      break
    }
  }
  if (branch === undefined) return fallback('no default branch: neither origin/HEAD, origin/main, origin/master, main nor master')
  const blob = await gitText(root, 'rev-parse', '--verify', '-q', `${branch}:${SENSITIVITY_FILE}`)
  if (blob === undefined) return fallback(`file absent on ${branch}`)
  const bytes = await git(root, ['cat-file', 'blob', blob])
  return bytes === undefined ? fallback(`not a file on ${branch}`) : readRules(bytes)
}

/** The default branch, in order, when origin/HEAD names none. */
const DEFAULT_BRANCHES = ['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']

/**
 * Read the sensitivity file of the worktree.
 * @param root - the repository root.
 * @returns the version.
 */
async function readWorktree(root: string): Promise<Version> {
  const path = join(root, SENSITIVITY_FILE)
  try {
    if (!(await lstat(path)).isFile()) return fallback('not a regular file in the worktree')
    return readRules(await readFile(path))
  } catch (error) {
    const code = errorCode(error)
    return fallback(code === 'ENOENT' ? 'file absent in the worktree' : `unreadable in the worktree (${code || 'unknown error'})`)
  }
}

/**
 * Read a version of the sensitivity file from its bytes.
 * @param bytes - the file's bytes.
 * @returns the version, with its fingerprint, and its rules unless it is invalid.
 */
function readRules(bytes: Buffer): Version {
  const fingerprint = createHash('sha256').update(bytes).digest('hex')
  let file: SensitivityFile
  try {
    file = parseSensitivityFile(bytes.toString('utf8'))
  } catch (error) {
    return { rules: undefined, evidence: { fingerprint, fallback: (error as Error).message } }
  }
  const zones = file.zones.map(zone => ({ id: zone.id, class: zone.class, labels: zone.labels, patterns: zone.paths.map(compilePattern) }))
  return { rules: { default: file.default, zones }, evidence: { fingerprint } }
}

/**
 * Make a version that falls back to C3 for lack of a file to read.
 * @param reason - why.
 * @returns the version.
 */
function fallback(reason: string): Version {
  return { rules: undefined, evidence: { fingerprint: null, fallback: reason } }
}

/**
 * Find the class a version of the sensitivity file gives a path.
 * @param rules - the version.
 * @param path - the path's folded segments.
 * @returns the class and the zones that cover the path.
 */
function match(rules: Rules, path: FoldedPath): { class: SensitivityClass, zones: CompiledZone[] } {
  const zones = rules.zones.filter(zone => zone.patterns.some(pattern => covers(pattern, path)))
  return { class: zones.map(zone => zone.class).reduce(highest, rules.default), zones }
}

/**
 * Rank a class, from 0 for C0 to 3 for C3.
 * @param sensitivity - the class.
 * @returns its rank.
 */
function rank(sensitivity: SensitivityClass): number {
  return SensitivityClass.options.indexOf(sensitivity)
}

/**
 * Pick the higher of two classes.
 * @param a - a class.
 * @param b - another class.
 * @returns the higher one.
 */
function highest(a: SensitivityClass, b: SensitivityClass): SensitivityClass {
  return rank(b) > rank(a) ? b : a
}

/**
 * Compile a path pattern of the format: relative to the repository root,
 * `/` as separator, `*` within a segment, `**` as a whole segment over any
 * depth, `?` for one character, case ignored. A pattern covers the paths it
 * matches and every path under them. What could exclude a path from a zone
 * without a word is refused: negation, absolute paths, `.` and `..`
 * segments, empty segments, and the characters `[`, `]`, `{`, `}` and `\`,
 * which each tool reads its own way.
 * @param pattern - a pattern of a zone.
 * @returns the pattern by segment.
 * @throws Error naming why the pattern is refused.
 */
function compilePattern(pattern: string): Pattern {
  if (pattern === '') throw new Error('empty pattern')
  if (pattern.startsWith('!')) throw new Error('negation is refused')
  if (pattern.startsWith('/')) throw new Error('absolute patterns are refused')
  if (/[[\]{}\\]/.test(pattern)) throw new Error('the characters [ ] { } \\ are refused')
  return pattern.split('/').map(segment => {
    if (segment === '') throw new Error('empty path segment')
    if (segment === '.' || segment === '..') throw new Error(`"${segment}" segments are refused`)
    if (segment === '**') return null
    if (segment.includes('**')) throw new Error('"**" must be a whole segment')
    return foldChars(segment)
  })
}

/**
 * Tell whether a pattern covers a path: matches it or one of its ancestors.
 * The match runs segment by segment and keeps every position the pattern
 * can have reached in the path, so its cost stays within the product of the
 * two lengths, however many `**` and `*` the pattern holds.
 * @param pattern - the pattern.
 * @param path - the path's folded segments.
 * @returns true when the pattern covers the path.
 */
function covers(pattern: Pattern, path: FoldedPath): boolean {
  let reached = new Uint8Array(path.length + 1)
  let next = new Uint8Array(path.length + 1)
  reached[0] = 1
  for (const segment of pattern) {
    next.fill(0)
    for (let position = 0; position <= path.length; position++) {
      if (reached[position] === 0) continue
      if (segment === null) {
        next.fill(1, position)
        break
      }
      const name = path[position]
      if (name !== undefined && matchSegment(segment, name)) next[position + 1] = 1
    }
    const done = reached
    reached = next
    next = done
  }
  return reached.includes(1, 1)
}

/**
 * Match a segment of a pattern against a name, `*` for any characters and
 * `?` for one. On a mismatch, only the last `*` met takes one more
 * character, so the cost stays within the product of the two lengths.
 * @param segment - the pattern's folded characters.
 * @param name - the name's folded characters.
 * @returns true when the segment matches the whole name.
 */
function matchSegment(segment: readonly string[], name: readonly string[]): boolean {
  let at = 0
  let star = -1
  let resume = 0
  for (let index = 0; index < name.length;) {
    if (segment[at] === '*') {
      star = at++
      resume = index
    } else if (at < segment.length && (segment[at] === '?' || segment[at] === name[index])) {
      at++
      index++
    } else if (star >= 0) {
      at = star + 1
      index = ++resume
    } else {
      return false
    }
  }
  while (segment[at] === '*') at++
  return at === segment.length
}

/**
 * Fold a path for a comparison without case, NFC-normalized.
 * @param path - the path.
 * @returns the folded path.
 */
function foldPath(path: string): string {
  return foldChars(path).join('')
}

/**
 * Fold the characters of a text for a comparison without case, NFC-normalized.
 * @param text - the text.
 * @returns its characters, each folded.
 */
function foldChars(text: string): string[] {
  return [...text.normalize('NFC')].map(foldChar)
}

/**
 * Fold a character for a comparison without case: lowercase it, uppercase
 * it, then lowercase it again, each step kept only when it gives a single character.
 * `S`, `s` and `ſ` compare equal, as do `Σ`, `σ` and `ς`; `İ` keeps its own
 * form, its lowercase being two characters.
 * @param char - the character.
 * @returns its folded form.
 */
function foldChar(char: string): string {
  let folded = FOLDED.get(char)
  if (folded === undefined) {
    folded = char
    for (const change of CASE_CHANGES) {
      const changed = change(folded)
      if ([...changed].length === 1) folded = changed
    }
    FOLDED.set(char, folded)
  }
  return folded
}
