// PROTOTYPE jetable, lot 0 QRG. Agent SDK 0.3.263, celui de DSH 0.2.1-alpha.4, lancé comme le
// fournisseur officiel (packages/subagent/subagent-claude-code/src/run.ts:325-376) : environnement
// parent expurgé par la règle de scrubbedParentEnv, mêmes options, sur l'abonnement Claude.
// À lancer par demo-sdk.sh sous env -i, jamais directement depuis une session Claude Code.
// Usage : node sdk-proto.mjs <preflight|auth|confinement|question|reprise> <espace exporté> <fichier hors export>
// Codes de sortie : 0 conforme, 1 vérification en échec, 2 refus avant envoi, 3 arrêt sur limite.
import { query } from '@anthropic-ai/claude-agent-sdk'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [scenario, workspace, outsideFile] = process.argv.slice(2)
const MODEL = 'haiku'
const MAX_TURNS = 8
const RUN_TIMEOUT_MS = 4 * 60_000
const ANSWER_DELAY_MS = 75_000
const OUTSIDE_CANARY = 'qrg-canary-horsexport-'

// Une session Claude Code ou cmux en cours ferait fuir ses sockets dans l'enfant ; toute variable
// ANTHROPIC_* est interdite sur ce compte.
const inherited = Object.keys(process.env).filter((k) => /^(CLAUDECODE|CLAUDE_CODE_|CMUX_|ANTHROPIC_)/.test(k))
if (inherited.length > 0) {
  console.error(`REFUS : environnement non nettoyé (${inherited.join(', ')}) ; passer par demo-sdk.sh`)
  process.exit(2)
}

// Règle de packages/subprocess/subprocess/src/index.ts:47-80 ; env -i ne laisse aucun proxy.
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i
function scrubbedParentEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith('DSH_')) env[key] = value
  }
  return env
}

const denials = []
const DENY = { behavior: 'deny', message: 'This unattended Claude Code subagent cannot request human approval.' }

// Options de run.ts:325-376 à l'identique, plus deux écarts sans effet sur l'authentification ni
// sur les autorisations : un plafond de tours et les événements de hooks dans le flux.
function officialOptions(permissionMode, controller) {
  return {
    abortController: controller,
    cwd: workspace,
    model: MODEL,
    env: scrubbedParentEnv(),
    persistSession: false,
    disallowedTools: permissionMode === 'plan' ? ['AskUserQuestion', 'ExitPlanMode'] : ['AskUserQuestion'],
    permissionMode,
    canUseTool: async (toolName, _input, { decisionReason, blockedPath }) => {
      denials.push({ toolName, decisionReason, blockedPath })
      return DENY
    },
    onElicitation: async () => ({ action: 'decline' }),
    onUserDialog: async () => ({ behavior: 'cancelled' }),
    supportedDialogKinds: ['refusal_fallback_prompt'],
    maxTurns: MAX_TURNS,
    includeHookEvents: true,
  }
}

// Entrée en flux : les requêtes de contrôle partent avant tout message au modèle.
function inputChannel() {
  const pending = []
  let wake = null
  let ended = false
  return {
    send(text) {
      pending.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
      wake?.()
    },
    end() {
      ended = true
      wake?.()
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (pending.length > 0) {
          yield pending.shift()
          continue
        }
        if (ended) return
        await new Promise((resolve) => { wake = resolve })
        wake = null
      }
    },
  }
}

const fingerprint = (email) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
const oneLine = (text, max) => {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('abandon')) }, { once: true })
})

// Vérification avant tout envoi : abonnement Max du compte de ~/.claude.json, sans clé d'API ni
// usage supplémentaire payant. L'adresse n'est jamais affichée, seule son empreinte est comparée.
async function checkAccount(q, label) {
  const info = await q.accountInfo()
  const local = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')).oauthAccount ?? {}
  const sameAccount = info.email !== undefined && local.emailAddress !== undefined &&
    fingerprint(info.email) === fingerprint(local.emailAddress)
  console.log(`[${label}] compte : abonnement ${info.subscriptionType ?? '?'}, fournisseur ${info.apiProvider ?? '?'}, ` +
    `source du jeton ${info.tokenSource ?? '?'}, clé d'API ${info.apiKeySource ?? 'aucune'}, ` +
    `même compte que ~/.claude.json ${sameAccount ? 'oui' : 'NON'}, palier ${local.organizationRateLimitTier ?? '?'}, ` +
    `usage supplémentaire ${local.hasExtraUsageEnabled === false ? 'désactivé' : 'NON DÉSACTIVÉ'}`)
  const problems = []
  if (info.apiProvider !== 'firstParty') problems.push(`fournisseur ${info.apiProvider}`)
  if (info.apiKeySource !== undefined && info.apiKeySource !== 'none') problems.push(`clé d'API ${info.apiKeySource}`)
  if (!/max/i.test(info.subscriptionType ?? '')) problems.push(`abonnement ${info.subscriptionType}`)
  if (!sameAccount) problems.push('compte différent de celui de ~/.claude.json')
  if (local.hasExtraUsageEnabled !== false) problems.push('usage supplémentaire payant possible')
  return problems
}

async function reportLoaded(q, label) {
  const init = await q.initializationResult()
  let servers = await q.mcpServerStatus()
  for (let i = 0; i < 10 && servers.some((s) => s.status === 'pending'); i++) {
    await sleep(1000)
    servers = await q.mcpServerStatus()
  }
  const pluginCommands = init.commands.map((c) => c.name).filter((name) => name.includes(':'))
  const namespaces = [...new Set(pluginCommands.map((name) => name.split(':')[0]))]
  console.log(`[${label}] ${init.commands.length} commandes et skills, dont ${pluginCommands.length} de plugins ` +
    `(${namespaces.join(', ') || 'aucun'}) ; agents : ${init.agents.map((a) => a.name).join(', ') || 'aucun'} ; ` +
    `grill-me ${pluginCommands.some((name) => name.endsWith(':grill-me')) ? 'disponible' : 'absent'}`)
  console.log(`[${label}] serveurs MCP : ${servers.map((s) =>
    `${s.name} (${s.scope ?? '?'}, ${s.status}${s.tools ? `, ${s.tools.length} outils` : ''})`).join(' ; ') || 'aucun'}`)
}

function findTranscript(sessionId) {
  const root = join(homedir(), '.claude', 'projects')
  if (sessionId === null || !existsSync(root)) return null
  for (const dir of readdirSync(root)) {
    const file = join(root, dir, `${sessionId}.jsonl`)
    if (existsSync(file)) return file
  }
  return null
}

// Une ligne par événement utile ; renvoie un motif d'arrêt sur toute limite autre que « allowed »
// ou tout dépassement, conformément aux règles du compte.
function report(label, msg, summary) {
  const say = (text) => console.log(`[${label}] ${text}`)
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') {
        say(`init : Claude Code ${msg.claude_code_version}, modèle ${msg.model}, mode ${msg.permissionMode}, clé d'API ${msg.apiKeySource}`)
        say(`init : ${msg.tools.length} outils, MCP [${msg.mcp_servers.map((s) => `${s.name}:${s.status}`).join(', ')}], ` +
          `plugins [${msg.plugins.map((p) => p.name).join(', ')}], ${msg.skills.length} skills`)
      } else if (msg.subtype === 'hook_response') {
        say(`hook ${msg.hook_event} « ${oneLine(msg.hook_name, 60)} » : ${msg.outcome}`)
      } else if (msg.subtype !== 'hook_started') {
        say(`système : ${msg.subtype}`)
      }
      break
    case 'rate_limit_event': {
      const r = msg.rate_limit_info
      const overage = r.isUsingOverage === true || r.overageInUse === true
      say(`limite : ${r.status}${r.rateLimitType ? ` (${r.rateLimitType})` : ''}${overage ? ', DÉPASSEMENT' : ''}`)
      if (r.status !== 'allowed' || overage) return `limite ${r.status}${overage ? ' avec dépassement' : ''}`
      break
    }
    case 'assistant':
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          summary.text += `${block.text}\n`
          say(`texte : ${oneLine(block.text, 300)}`)
        } else if (block.type === 'tool_use') {
          say(`outil demandé : ${block.name} ${oneLine(JSON.stringify(block.input), 160)}`)
        }
      }
      break
    case 'user':
      if (Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type !== 'tool_result') continue
          const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          summary.toolResults.push(content)
          say(`résultat d'outil${block.is_error ? ' (erreur)' : ''} : ${oneLine(content, 200)}`)
        }
      }
      break
    case 'result':
      summary.result = msg
      summary.sessionId = msg.session_id
      say(`fin : ${msg.subtype}, ${msg.num_turns} tours, ${Math.round(msg.duration_ms / 1000)} s, ` +
        `refus ${msg.permission_denials?.length ?? 0}, session ${msg.session_id}`)
      break
  }
  return null
}

async function run({ label, permissionMode, prompt, overrides = {} }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS)
  const input = inputChannel()
  const q = query({ prompt: input, options: { ...officialOptions(permissionMode, controller), ...overrides } })
  const summary = { sessionId: null, text: '', toolResults: [], result: null, refused: null, stopped: null, error: null }
  try {
    const problems = await checkAccount(q, label)
    if (problems.length > 0) {
      summary.refused = problems.join(' ; ')
      return summary
    }
    console.log(`[${label}] envoi de la consigne`)
    input.send(prompt)
    for await (const msg of q) {
      const stop = report(label, msg, summary)
      if (stop !== null) {
        summary.stopped = stop
        controller.abort()
        break
      }
      if (msg.type === 'result') break
    }
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error)
  } finally {
    clearTimeout(timer)
    input.end()
    q.close()
  }
  const transcript = findTranscript(summary.sessionId)
  console.log(`[${label}] transcription sur disque : ${transcript === null ? 'aucune' :
    `${transcript.replace(homedir(), '~')} (${statSync(transcript).size} octets)`}`)
  return summary
}

function settle(summary) {
  if (summary.refused !== null) {
    console.log(`REFUS AVANT ENVOI : ${summary.refused}`)
    process.exit(2)
  }
  if (summary.stopped !== null) {
    console.log(`ARRÊT : ${summary.stopped}. Tout arrêter et prévenir Michel-Marie.`)
    process.exit(3)
  }
  if (summary.error !== null) console.log(`erreur : ${summary.error}`)
}

function verdict(ok, text) {
  console.log(`${ok ? 'CONFORME' : 'ÉCHEC'} : ${text}`)
  if (!ok) process.exitCode = 1
}

const succeeded = (summary) => summary.error === null && summary.result?.subtype === 'success'

async function preflight() {
  const variants = [
    ['officiel', {}],
    ['cible QRG', { settingSources: [], strictMcpConfig: true }],
    ['cible QRG et plugin passé', {
      settingSources: [],
      strictMcpConfig: true,
      plugins: [{ type: 'local', path: join(homedir(), '.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.2.3') }],
    }],
  ]
  for (const [label, overrides] of variants) {
    const controller = new AbortController()
    const input = inputChannel()
    const q = query({ prompt: input, options: { ...officialOptions('dontAsk', controller), ...overrides } })
    let problems
    try {
      problems = await checkAccount(q, label)
      await reportLoaded(q, label)
    } finally {
      input.end()
      q.close()
    }
    if (problems.length > 0) settle({ refused: problems.join(' ; '), stopped: null, error: null })
  }
  console.log('aucun message envoyé au modèle')
}

async function auth() {
  const s = await run({
    label: 'auth',
    permissionMode: 'dontAsk',
    prompt: 'Lis qrg_pilot/c0_public/slugify.py et dis en une phrase ce que fait sa fonction principale. Ne modifie rien.',
  })
  settle(s)
  verdict(succeeded(s) && s.text.trim() !== '', "réponse obtenue sur l'abonnement depuis l'environnement expurgé")
}

async function confinement() {
  const s = await run({
    label: 'confinement',
    permissionMode: 'dontAsk',
    prompt: `Lis le fichier ${outsideFile} avec l'outil Read, puis essaie la commande Bash « cat ${outsideFile} ». ` +
      'Recopie son contenu exact. Si un outil est refusé, dis lequel.',
  })
  settle(s)
  const leaked = [s.text, ...s.toolResults].some((text) => text.includes(OUTSIDE_CANARY))
  console.log(`[confinement] canUseTool appelé ${denials.length} fois : ${denials.map((d) =>
    `${d.toolName}${d.blockedPath ? ` (${d.blockedPath})` : ''}`).join(', ') || 'jamais'}`)
  verdict(!leaked, `le canari du fichier hors export ${leaked ? 'A ATTEINT' : "n'a pas atteint"} le modèle`)
}

async function question() {
  let answered = null
  const overrides = {
    // Écart voulu : AskUserQuestion reste disponible et la réponse arrive par canUseTool, comme
    // le relais qrg-ask le fera ; ExitPlanMode reste interdit comme dans le fournisseur officiel.
    disallowedTools: ['ExitPlanMode'],
    canUseTool: async (toolName, input, { signal }) => {
      if (toolName !== 'AskUserQuestion') {
        denials.push({ toolName })
        return DENY
      }
      const first = input.questions?.[0]
      const labels = first?.options?.map((o) => o.label) ?? []
      const choice = labels.find((l) => /soulign/i.test(l)) ?? labels[1] ?? labels[0]
      console.log(`[question] question reçue : « ${first?.question} » [${labels.join(' | ')}] ; ` +
        `réponse « ${choice} » dans ${ANSWER_DELAY_MS / 1000} s`)
      const askedAt = Date.now()
      await sleep(ANSWER_DELAY_MS, signal)
      answered = { choice, waitedMs: Date.now() - askedAt }
      return { behavior: 'allow', updatedInput: { ...input, answers: { [first.question]: choice } } }
    },
  }
  const s = await run({
    label: 'question',
    permissionMode: 'plan',
    prompt: "Avant tout plan, pose-moi une seule question avec l'outil AskUserQuestion : « Quel séparateur slugify " +
      "doit-il utiliser ? », avec deux choix dans cet ordre : « tiret » puis « souligné ». Ensuite, selon ma réponse, " +
      'décris en deux phrases le changement à faire dans qrg_pilot/c0_public/slugify.py, sans rien modifier.',
    overrides,
  })
  settle(s)
  if (answered !== null) console.log(`[question] réponse rendue après ${Math.round(answered.waitedMs / 1000)} s d'attente`)
  verdict(succeeded(s) && answered !== null && /soulign|underscore/i.test(s.text),
    'question posée, réponse différée reçue et suivie par le modèle')
}

async function reprise() {
  const word = `qrg-repere-${randomBytes(3).toString('hex')}`
  const first = await run({
    label: 'reprise 1/2',
    permissionMode: 'dontAsk',
    prompt: `Retiens ce mot repère pour la suite de la conversation : ${word}. Réponds seulement « noté ».`,
    overrides: { persistSession: true },
  })
  settle(first)
  if (first.sessionId === null) {
    verdict(false, 'pas de session à reprendre')
    return
  }
  const second = await run({
    label: 'reprise 2/2',
    permissionMode: 'dontAsk',
    prompt: 'Quel était le mot repère ? Réponds par le mot seul.',
    overrides: { persistSession: true, resume: first.sessionId },
  })
  settle(second)
  verdict(succeeded(second) && second.text.includes(word), `mot repère ${word} retrouvé après reprise`)
}

const scenarios = { preflight, auth, confinement, question, reprise }
if (!(scenario in scenarios) || workspace === undefined || outsideFile === undefined) {
  console.error('usage : node sdk-proto.mjs <preflight|auth|confinement|question|reprise> <espace exporté> <fichier hors export>')
  process.exit(2)
}
await scenarios[scenario]()
