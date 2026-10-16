// PROTOTYPE jetable, lot 0 QRG. Export sans historique d'un dépôt pour un couple servi hors de
// LINAGORA, puis preuves : ni historique, ni fichier non suivi, ni canari d'un contenu exclu.
// Usage : node export.mjs --repo <dépôt> --max-class <C0..C3> --out <répertoire neuf>
// Le dépôt source n'est que lu (commandes git de lecture) ; tout s'écrit dans --out.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { CLASSES, admits, classifyPath, maxClass, parseSensitivity, resolveLinkTarget } from './classify.mjs'

const FILE = '.linagora/sensitivity.yml'
const CANARY = /qrg-canary-[a-z0-9]+-[0-9a-f]{8}/g
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'

const { values } = parseArgs({ options: { repo: { type: 'string' }, 'max-class': { type: 'string' }, out: { type: 'string' } } })
const repo = resolve(values.repo)
const limit = values['max-class']
const out = resolve(values.out)
if (!CLASSES.includes(limit)) throw new Error('--max-class attendu : C0 à C3')
if (out === repo || out.startsWith(repo + sep)) throw new Error("l'export doit être hors du dépôt")
const present = (path) => { try { lstatSync(path); return true } catch { return false } }
if (present(out) && readdirSync(out).length > 0) throw new Error(`${out} n'est pas vide`)

const git = (cwd, args) => execFileSync('git', ['-C', cwd, '-c', 'core.quotepath=off', ...args], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
const tryGit = (cwd, args) => { try { return git(cwd, args) } catch { return null } }
const blob = (sha) => git(repo, ['cat-file', 'blob', sha])
const digest = (text) => (text === null ? '-' : createHash('sha256').update(text).digest('hex').slice(0, 12))

// 1. Version de confiance (branche par défaut) et version de l'arbre de travail.
function trustedRef() {
  const head = tryGit(repo, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'])
  if (head !== null) return head.toString().trim()
  for (const name of ['main', 'master']) {
    if (tryGit(repo, ['rev-parse', '--verify', '-q', `refs/heads/${name}`]) !== null) return `refs/heads/${name}`
  }
  return null
}
const ref = trustedRef()
const trustedText = ref === null ? null : (tryGit(repo, ['show', `${ref}:${FILE}`])?.toString() ?? null)
let worktreeText = null
let worktreeReadError = null
try { worktreeText = readFileSync(join(repo, FILE), 'utf8') } catch (error) { if (error.code !== 'ENOENT') worktreeReadError = error.message }
const trusted = parseSensitivity(trustedText)
const worktree = worktreeReadError === null ? parseSensitivity(worktreeText) : { error: `illisible : ${worktreeReadError}` }

// 2. Chemins suivis au commit courant, classés ; un lien vaut aussi la classe de sa cible.
const head = git(repo, ['rev-parse', 'HEAD']).toString().trim()
const entries = git(repo, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).toString().split('\0').filter(Boolean).map((line) => {
  const tab = line.indexOf('\t')
  const [mode, type, sha] = line.slice(0, tab).split(' ')
  return { mode, type, sha, path: line.slice(tab + 1) }
})
const byPath = new Map(entries.map((entry) => [entry.path, entry]))

function classOf(path, depth = 0) {
  const base = classifyPath(path, trusted, worktree)
  const entry = byPath.get(path)
  if (entry?.mode === '160000') return { ...base, cls: 'C3', reasons: ['sous-module sans fichier propre'] }
  if (entry?.mode !== '120000') return { ...base, reasons: [] }
  const target = blob(entry.sha).toString()
  const resolved = resolveLinkTarget(path, target)
  if (resolved === null || depth > 8) return { ...base, cls: 'C3', reasons: [`lien hors du dépôt vers ${target}`] }
  const targetCls = classOfTarget(resolved, depth + 1)
  return { ...base, cls: maxClass(base.cls, targetCls), reasons: [`lien vers ${resolved} (${targetCls})`] }
}
function classOfTarget(path, depth) {
  if (byPath.has(path)) return classOf(path, depth).cls
  const prefix = path === '' ? '' : `${path}/`
  const inside = entries.filter((entry) => entry.path.startsWith(prefix))
  if (inside.length > 0) return maxClass(...inside.map((entry) => classOf(entry.path, depth).cls))
  return classifyPath(path, trusted, worktree).cls
}

const rows = entries.map((entry) => ({ ...entry, ...classOf(entry.path) }))
const admitted = rows.filter((row) => admits(limit, row.cls))
const excluded = rows.filter((row) => !admits(limit, row.cls))

console.log(`Dépôt ${repo}`)
console.log(`  commit courant ${head.slice(0, 7)}, plafond du couple ${limit}`)
console.log(`  version de confiance (${ref ?? 'aucune branche par défaut'}) : ${trusted.error ?? 'valide'}, sha256 ${digest(trustedText)}`)
console.log(`  version de l'arbre de travail : ${worktree.error ?? 'valide'}, sha256 ${digest(worktreeText)}`)
if (trusted.error !== undefined || worktree.error !== undefined) {
  console.log('  FERMETURE PAR DÉFAUT : fichier absent ou invalide, tout le dépôt est classé C3 (incident tracé)')
}
const perClass = Object.fromEntries(CLASSES.map((cls) => [cls, rows.filter((row) => row.cls === cls).length]))
console.log(`  ${rows.length} chemins suivis : ${CLASSES.map((cls) => `${cls} ${perClass[cls]}`).join(', ')}`)
const lowered = rows.filter((r) => r.loweringIgnored)
for (const row of lowered.slice(0, 5)) {
  console.log(`  ABAISSEMENT IGNORÉ : ${row.path} vaut ${row.worktree} dans l'arbre de travail, ${row.trusted} sur la branche par défaut (tentative tracée)`)
}
if (lowered.length > 5) console.log(`  ... et ${lowered.length - 5} autres abaissements ignorés`)
console.log(`\nExclus de l'export (${excluded.length}) :`)
const shown = trusted.error !== undefined || worktree.error !== undefined ? excluded.slice(0, 5) : excluded
for (const row of shown) {
  const why = [row.zones.length ? `zones ${row.zones.join(', ')}` : '', row.builtin === 'C3' ? 'motif de secret intégré' : '', ...row.reasons].filter(Boolean).join(' ; ')
  console.log(`  ${row.cls}  ${row.path}${why ? `  (${why})` : ''}`)
}
if (shown.length < excluded.length) console.log(`  ... et ${excluded.length - shown.length} autres`)

if (admitted.length === 0) {
  console.log(`\nEXPORT REFUSÉ : aucun chemin admis pour un couple plafonné à ${limit}. Rien n'est écrit.`)
  process.exit(2)
}

// 3. Export : blobs du commit courant écrits un à un (sans export-subst ni export-ignore),
// puis un dépôt neuf à un seul commit.
mkdirSync(out, { recursive: true })
for (const row of admitted) {
  const dest = join(out, row.path)
  mkdirSync(dirname(dest), { recursive: true })
  if (row.mode === '120000') symlinkSync(blob(row.sha).toString(), dest)
  else {
    writeFileSync(dest, blob(row.sha))
    chmodSync(dest, row.mode === '100755' ? 0o755 : 0o644)
  }
}
const identity = ['-c', 'user.name=qrg-export', '-c', 'user.email=export@qrg.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']
git(out, ['init', '-q', '--template=', '-b', 'main'])
git(out, [...identity, 'add', '-A', '-f'])
git(out, [...identity, 'commit', '-q', '-m', `Export QRG plafonné à ${limit}`])
console.log(`\nExport écrit dans ${out} : ${admitted.length} chemins`)
if (admitted.some((row) => row.path === FILE)) {
  console.log(`  note : ${FILE} est exporté ; il nomme les zones exclues et leurs étiquettes`)
}

// 4. Preuves.
function walk(dir, prefix = '') {
  const found = []
  for (const name of readdirSync(dir)) {
    if (prefix === '' && name === '.git') continue
    const rel = prefix === '' ? name : `${prefix}/${name}`
    const stat = lstatSync(join(dir, name))
    if (stat.isDirectory()) found.push(...walk(join(dir, name), rel))
    else found.push(rel)
  }
  return found
}
const exported = walk(out)
const checks = []
const check = (name, ok, detail) => checks.push({ name, ok, detail })

const commits = git(out, ['rev-list', '--all', '--count']).toString().trim()
const sourceHeadPresent = tryGit(out, ['cat-file', '-e', `${head}^{commit}`]) !== null
const alternates = present(join(out, '.git/objects/info/alternates'))
const remotes = git(out, ['remote']).toString().trim()
check('historique', commits === '1' && !sourceHeadPresent && !alternates && remotes === '',
  `${commits} commit, commit source ${head.slice(0, 7)} ${sourceHeadPresent ? 'PRÉSENT' : 'absent'}, alternates ${alternates ? 'présents' : 'absents'}, remotes ${remotes || 'aucun'}`)

const untracked = git(repo, ['ls-files', '--others', '-z']).toString().split('\0').filter(Boolean)
const leaked = untracked.filter((path) => present(join(out, path)))
check('fichiers non suivis', leaked.length === 0,
  `${untracked.length} fichiers non suivis ou ignorés dans le dépôt, ${leaked.length} dans l'export${leaked.length ? ` : ${leaked.join(', ')}` : ''}`)

const canaries = new Set()
for (const row of excluded) if (row.mode !== '160000') for (const match of blob(row.sha).toString('utf8').matchAll(CANARY)) canaries.add(match[0])
for (const path of untracked) {
  try { for (const match of readFileSync(join(repo, path), 'utf8').matchAll(CANARY)) canaries.add(match[0]) } catch { /* fichier binaire ou disparu : rien à chercher */ }
}
const hits = []
for (const path of exported) {
  const full = join(out, path)
  const content = lstatSync(full).isSymbolicLink() ? readlinkSync(full) : readFileSync(full, 'latin1')
  for (const canary of canaries) if (content.includes(canary)) hits.push(`${canary} dans ${path}`)
}
check('canaris', hits.length === 0, `${canaries.size} cherchés (${[...canaries].sort().join(', ') || 'aucun'}), ${hits.length} trouvés${hits.length ? ` : ${hits.join(', ')}` : ''}`)

const excludedBlobs = new Map(excluded.map((row) => [row.sha, row.path]))
const copies = admitted.filter((row) => row.sha !== EMPTY_BLOB && excludedBlobs.has(row.sha)).map((row) => `${row.path} = ${excludedBlobs.get(row.sha)}`)
check('contenu exclu recopié sous un chemin admis', copies.length === 0, copies.length ? copies.join(', ') : 'aucun')

let materialized = 'C0'
for (const path of exported) {
  const full = join(out, path)
  let cls = classifyPath(path, trusted, worktree).cls
  if (lstatSync(full).isSymbolicLink()) {
    const resolved = resolveLinkTarget(path, readlinkSync(full))
    cls = resolved === null ? 'C3' : maxClass(cls, classifyPath(resolved, trusted, worktree).cls)
  }
  materialized = maxClass(materialized, cls)
}
const admittedPaths = new Set(admitted.map((row) => row.path))
const unexpected = exported.filter((path) => !admittedPaths.has(path))
check("classe de l'espace matérialisé", admits(limit, materialized) && unexpected.length === 0,
  `maximum ${materialized} pour un plafond ${limit}${unexpected.length ? `, fichiers inattendus : ${unexpected.join(', ')}` : ''}`)

console.log('\nPreuves :')
for (const { name, ok, detail } of checks) console.log(`  ${ok ? 'OK    ' : 'ÉCHEC '} ${name} : ${detail}`)
process.exit(checks.every((c) => c.ok) ? 0 : 1)
