// PROTOTYPE jetable, lot 0 QRG. Calcul de classe de notes/lot0-sensibilite.md, en
// fonctions pures sans entrée-sortie, pour être repris dans qrg-router au lot 1.
import { parseDocument } from 'yaml'

export const CLASSES = ['C0', 'C1', 'C2', 'C3']
const rank = (cls) => CLASSES.indexOf(cls)
export const maxClass = (...list) => list.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'C0')
export const admits = (limit, cls) => rank(cls) <= rank(limit)

export const BUILTIN_C3 = [
  '**/.env', '**/.env.local', '**/.env.*.local', '**/*.pem', '**/*.p12', '**/*.pfx',
  '**/id_rsa', '**/id_ecdsa', '**/id_ed25519', '**/.netrc',
]

// `*` ne traverse pas `/`, `**` occupe un segment entier, `?` vaut un caractère hors `/`,
// casse ignorée. Négation, chemin absolu, `..` et métacaractères non spécifiés : refus.
export function compileGlob(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) throw new Error('motif vide')
  if (pattern.startsWith('!')) throw new Error(`négation refusée : ${pattern}`)
  if (pattern.startsWith('/')) throw new Error(`chemin absolu refusé : ${pattern}`)
  if (pattern.split('/').includes('..')) throw new Error(`.. refusé : ${pattern}`)
  if (/[[\]{}\\]/.test(pattern)) throw new Error(`métacaractère non spécifié : ${pattern}`)
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      const next = pattern[i + 2]
      if ((i > 0 && pattern[i - 1] !== '/') || (next !== undefined && next !== '/')) {
        throw new Error(`** doit occuper un segment entier : ${pattern}`)
      }
      if (next === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
    } else if (ch === '*') re += '[^/]*'
    else if (ch === '?') re += '[^/]'
    else re += ch.replace(/[.+^$()|]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

const BUILTIN_RES = BUILTIN_C3.map(compileGlob)

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function checkKeys(object, allowed, where) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw new Error(`champ inconnu ${where} : ${key}`)
  }
}

function validate(raw) {
  if (!isPlainObject(raw)) throw new Error('la racine doit être un objet')
  checkKeys(raw, ['version', 'default', 'zones'], 'à la racine')
  if (raw.version !== 1) throw new Error(`version inconnue : ${raw.version}`)
  if (!CLASSES.includes(raw.default)) throw new Error(`classe par défaut inconnue : ${raw.default}`)
  const zones = raw.zones ?? []
  if (!Array.isArray(zones)) throw new Error('zones doit être une liste')
  const ids = new Set()
  return {
    default: raw.default,
    zones: zones.map((zone) => {
      if (!isPlainObject(zone)) throw new Error('zone non objet')
      checkKeys(zone, ['id', 'class', 'paths', 'labels', 'description'], 'de zone')
      if (typeof zone.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(zone.id)) {
        throw new Error(`identifiant de zone invalide : ${zone.id}`)
      }
      if (ids.has(zone.id)) throw new Error(`identifiant de zone en double : ${zone.id}`)
      ids.add(zone.id)
      if (!CLASSES.includes(zone.class)) throw new Error(`classe inconnue : ${zone.class}`)
      if (!Array.isArray(zone.paths) || zone.paths.length === 0) throw new Error(`zone ${zone.id} sans chemins`)
      const labels = zone.labels ?? []
      if (!Array.isArray(labels) || labels.some((l) => typeof l !== 'string')) throw new Error(`étiquettes invalides : ${zone.id}`)
      return { id: zone.id, class: zone.class, labels, res: zone.paths.map(compileGlob) }
    }),
  }
}

// Texte du fichier (ou null s'il est absent) vers { config } ou { error } ; une erreur
// ferme par défaut : tout le dépôt passe en C3.
export function parseSensitivity(text) {
  if (text === null) return { error: 'fichier absent' }
  const doc = parseDocument(text, { schema: 'core', uniqueKeys: true })
  const problems = [...doc.errors, ...doc.warnings]
  if (problems.length > 0) return { error: `YAML refusé : ${problems[0].message.split('\n')[0]}` }
  try {
    return { config: validate(doc.toJS({ maxAliasCount: 0 })) }
  } catch (error) {
    return { error: error.message }
  }
}

function classInVersion(path, parsed) {
  if (parsed.error !== undefined) return { cls: 'C3', zones: [] }
  let cls = parsed.config.default
  const zones = []
  for (const zone of parsed.config.zones) {
    if (zone.res.some((re) => re.test(path))) {
      cls = maxClass(cls, zone.class)
      zones.push(zone.id)
    }
  }
  return { cls, zones }
}

// Classe d'un chemin : maximum du défaut, des zones et des motifs intégrés, pour chacune des
// deux versions du fichier ; une branche peut relever une classe, jamais l'abaisser.
export function classifyPath(path, trusted, worktree) {
  const t = classInVersion(path, trusted)
  const w = classInVersion(path, worktree)
  const builtin = BUILTIN_RES.some((re) => re.test(path)) ? 'C3' : 'C0'
  return {
    cls: maxClass(t.cls, w.cls, builtin),
    trusted: t.cls,
    worktree: w.cls,
    builtin,
    zones: [...new Set([...t.zones, ...w.zones])],
    loweringIgnored: rank(w.cls) < rank(t.cls),
  }
}

// Cible d'un lien, relative à la racine, ou null si elle est absolue ou sort du dépôt.
export function resolveLinkTarget(linkPath, target) {
  if (target.startsWith('/')) return null
  const parts = linkPath.split('/').slice(0, -1)
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(segment)
  }
  return parts.join('/')
}
