# Hand-off : QRG, personnalisation de DeepSeek Harness avec query routing

Destinataire : session Claude Code ouverte avec le compte **mmaudet@linagora.com**.
Origine : session de cadrage des 15 et 16 octobre 2026 (compte personnel du porteur).
Porteur : Michel-Marie Maudet, DG de LINAGORA.

La spécification complète est dans `SPEC.md`, fourni avec ce fichier. Lis-la en entier avant d'agir : elle fait foi en cas de doute. Ce hand-off dit quoi construire, dans quel ordre, et avec quelles règles.

## 1. Objectif

Construire **QRG** (query routing) : un profil DeepSeek Harness (DSH, MIT, `deepseek-ai/deepseek-harness`) personnalisé par LINAGORA, qui :

1. choisit pour chaque tâche le couple agent/modèle le plus adapté, selon des règles et la sensibilité des données ;
2. délègue à Claude Code, à un agent natif via l'AI Gateway LINAGORA ou à un agent ACP ;
3. laisse l'utilisateur dialoguer avec l'agent délégué, y compris un skill interactif comme grill-me dans Claude Code ;
4. affiche dans la session les tokens consommés et les tokens Claude évités.

Stratégie sous-jacente : éviter une nouvelle dépendance à Anthropic tout en gardant Claude Code là où il apporte le plus. `qrg` est aussi le préfixe de tous les composants et commandes.

## 2. Ce qu'il faut livrer

| Composant | Nature dans DSH | Rôle |
| --- | --- | --- |
| Profil `qrg` | Profil DSH | Assemble les plugins ci-dessous, déclare l'AI Gateway comme fournisseur compatible OpenAI et ses modèles (Qwen, Mistral, DeepSeek), porte la politique de routage |
| `qrg-router` | Plugin DSH | Calcule la classe de sensibilité, décide du couple agent/modèle (règles, puis juge local, puis Jev), délègue via `ctx.subagents`, expose les outils `route_and_delegate` et `explain_route` |
| `qrg-claude-code` | Fournisseur de sous-agent (fork du fournisseur officiel) | Claude Code continuable et interactif : `AskUserQuestion`, autorisations et élicitations relayées à l'utilisateur, sessions persistées |
| `qrg-ask` | Relais du plugin + serveur MCP | Achemine toutes les questions des agents vers l'interface DSH ; outil `ask_user` pour les agents natifs |
| `qrg-meter` | Plugin de l'interface web | Pastille des tokens consommés et des tokens Claude évités, détail par tâche |

## 3. Décisions déjà prises (ne pas rouvrir sans demande explicite)

| Sujet | Décision |
| --- | --- |
| Fournisseur Claude Code | Fork LINAGORA open source du fournisseur officiel DSH ; callbacks interactifs proposés au projet DSH |
| Routage | Règles d'abord ; juge local (petit Qwen via la gateway, JSON contraint) ; Jev (TypeSafe AI) seul moteur externe, pour C0 et C1 uniquement, désactivé tant que son contrat n'est pas validé |
| Sensibilité | Grille C0 à C3, calculée depuis `.linagora/sensitivity.yml`, jamais par un modèle ; C2 et C3 ne quittent jamais les modèles hébergés par LINAGORA |
| Accès Anthropic | Abonnements individuels ; le plugin ne touche jamais les identifiants Claude ; le trafic Claude Code ne passe pas par la gateway |
| Offre commerciale | Authentification Claude au choix du client final |
| Compteur | Mesure principale : tokens Claude évités, avec fourchette |
| Paperclip | Aucune intégration |
| Dépôt pilote | `linagora/claude-delegate` |
| Évaluation | Tests fonctionnels avec le code ; mesure en usage réel au lot 3 ; banc d'évaluation seulement plus tard (annexe A) |
| Decision 3.0, Laya | Abandonnés |

## 4. Faits techniques établis (vérifiés dans le code ou la documentation)

- Le fournisseur officiel `packages/subagent/subagent-claude-code/src/run.ts` (Claude Agent SDK 0.3.263) place `AskUserQuestion` dans `disallowedTools`, refuse tout via `canUseTool`, décline `onElicitation`, annule `onUserDialog` et fixe `persistSession: false`. C'est la seule cause du blocage de grill-me.
- Le SDK route `AskUserQuestion` vers `canUseTool` (réponses dans `updatedInput.answers`) ; le callback peut attendre indéfiniment ; un hook `PreToolUse` avec `defer` permet d'arrêter le processus et de reprendre plus tard. `AskUserQuestion` n'existe pas dans les sous-agents Claude Code : grill-me doit tourner en session principale.
- Le sous-agent natif `spawn` accepte `agentOptions` (fournisseur LLM, modèle, effort de raisonnement) et `persona` ; les fournisseurs Claude Code, Codex et ACP refusent `agentOptions`.
- `packages/subagent/subagent-acp/src/run.ts` annonce `clientCapabilities: {}` et `mcpServers: []` : ni élicitation ni injection MCP possibles sans modification.
- Les tests DSH fournissent un faux serveur Anthropic Messages (`tests/messages-fixture.ts`) et un faux serveur ACP, à réutiliser pour des tests déterministes.
- Bug DSH #4065 : un enfant peut hériter d'un modèle périmé ; toujours passer le modèle explicitement.
- Installation d'un plugin dans un profil, forme relevée sur le catalogue communautaire : `npx -y @deepseek-ai/dsh plugin --profile <profil> add <source>`. À confirmer dans la documentation DSH.

## 5. Plan de construction

Travaille lot par lot. Chaque lot se termine par une démonstration à Michel-Marie sur le dépôt pilote. Utilise le mot « lot », jamais « phase ». Les tests de `SPEC.md` (identifiants D, L, Q, S, C, E) s'écrivent avec le code du lot concerné.

**Lot 0 : préparation**

1. Installer DSH (`npx @deepseek-ai/dsh`), lancer l'interface web (`npx @deepseek-ai/dsh web`), cloner `deepseek-ai/deepseek-harness` en lecture et `linagora/claude-delegate` comme dépôt pilote.
2. Étudier dans le code et la documentation DSH ce qu'il faut pour écrire un plugin, un fournisseur de sous-agent, un profil et un composant de l'interface web (Cordis, `ctx.subagents`, manifeste de plugin, fixtures de test). Livrer une note courte : points d'extension utilisés par chaque composant QRG.
3. Proposer l'organisation des dépôts (un monorepo `qrg` ou un dépôt par composant). Attendre validation avant de créer quoi que ce soit sur GitHub.
4. Auditer les plugins candidats à réutiliser (`dsh-plugin-product-subagents`, `dsh-agent-delegate`, `loongsuite/dsh-plugin`, `dsh-observe`, `dsh-live-stats`, `dsh-balance-meter`) : licence, maintenance, code qui voit passer prompts ou secrets. Verdict : retenu, adapté ou écarté.
5. Spécifier `.linagora/sensitivity.yml` et l'ajouter au dépôt pilote avec des zones C0 à C3 fictives.

**Lot 1 : profil `qrg` et routage à règles**

Profil `qrg` branché sur l'AI Gateway ; `qrg-router` avec politique YAML, calcul de sensibilité, `route_and_delegate`, `explain_route`, délégation native avec modèle explicite, Claude Code via le fournisseur officiel (mode ponctuel) ; traces OpenTelemetry ; `qrg-meter` en consommation réelle.
Démonstration : sur claude-delegate, une tâche de documentation C0 part vers Qwen, une spécification ambiguë part vers Claude Code, une tâche en zone C3 ne sort jamais de l'infrastructure LINAGORA, et la pastille affiche les tokens.

**Lot 2 : interaction**

`qrg-claude-code` (retirer `AskUserQuestion` de `disallowedTools`, relayer `canUseTool` et `onElicitation`, `persistSession: true` et `resume`, entrée en streaming, hook `defer`) ; relais `qrg-ask` commun ; outil MCP `ask_user` pour les agents natifs ; discussion à ouvrir côté DSH.
Démonstration : grill-me mené depuis l'interface DSH, interrompu puis repris, puis implémentation routée vers un agent natif.

**Lot 3 : décision avancée et mesure**

Juge local Qwen ; Jev après validation du contrat ; mesure en usage réel (tests verts après délégation, relances, forçages de `@claude`) visible dans Langfuse ; recalibrage du compteur ; commande `/qrg-stats`.

**Lot 4 : industrialisation**

Autorisations Claude Code relayées à l'utilisateur, canal Twake Chat, packaging de l'offre (authentification Claude au choix du client).

## 6. Règles d'usage de ce compte

Ce compte Max 20x est dédié au projet QRG ; l'autre compte de Michel-Marie reste réservé à son travail quotidien.

- Usage ordinaire de développement uniquement : aucune exécution automatisée en masse sans accord de Michel-Marie.
- Ne jamais répartir une charge de travail sur les deux comptes.
- Aucune variable `ANTHROPIC_API_KEY` ; refuser tout dépassement payant ; vérifier la facturation avec `/status`.
- Dans les tests impliquant Claude Code, uniquement du code open source déjà publié et des zones sensibles fictives.
- Au premier avertissement d'Anthropic, tout arrêter et prévenir Michel-Marie.

## 7. Points ouverts

- Organisation et noms des dépôts (lot 0).
- Vérification du contrat et de la rétention des données chez TypeSafe AI avant toute activation de Jev.
- Commande exacte d'installation des plugins et du mode sans interface de DSH, à confirmer dans sa documentation.

## 8. Manière de travailler attendue

- Réponses directes et concises, en français, en prose plutôt qu'en listes quand c'est possible ; jamais de tiret cadratin.
- Ne rien publier, pousser ni créer sur GitHub sans accord explicite.
- Signaler tout écart entre la spec et la réalité du code plutôt que de le contourner en silence ; mettre à jour `SPEC.md` en conséquence.
- Michel-Marie est aussi Security Officer : toute question de sécurité ou de données sort du flux et lui est posée directement.

## Annexe A : banc d'évaluation `qrg-eval` (plus tard, sur accord)

À ne construire qu'une fois QRG utilisé au quotidien, et à ne lancer qu'avec l'accord de Michel-Marie.

Principe : prendre des commits réels de dépôts open source LINAGORA dont les tests donnent la bonne réponse, faire refaire la modification par chaque couple agent/modèle, et voir qui réussit et à quel coût. Un modèle (ni juge ni candidat) rédige la demande à partir du diff ; les agents ne voient que la demande ; les tests du commit servent d'arbitre. L'étiquette d'une tâche est le couple le moins coûteux qui réussit ; on compare ensuite le choix du routeur à cette étiquette.

Taille : une mini-campagne d'environ 40 tâches (25 rejeux de commits, 10 synthétiques jugées par deux modèles de familles différentes, 5 interactives avec utilisateur simulé), une exécution par tâche dans Claude Code et deux par agent natif. Environ un à deux jours de quota Max, équivalent API de l'ordre de 100 $.

Claude Code s'exécute sans interface et rend l'usage en tokens :

```bash
claude -p "$(cat taches/042/demande.md)" \
  --output-format json \
  --permission-mode acceptEdits \
  --max-turns 40 > resultats/042.claude.json
```

Outil proposé :

```bash
qrg-eval generate --repos linagora/claude-delegate,... --count 35
qrg-eval run --couples claude-code,qwen-local,mistral-local --runs-native 2 --pace max20x
qrg-eval report > rapport-mini-campagne.md
```

`--pace max20x` espace les exécutions, s'arrête à la première alerte de limite et reprend à la réinitialisation. Le rapport donne le taux de bon routage, les erreurs grossières à corriger dans les règles, les tokens par profil et le ratio de calibration du compteur.

## Référence

La spec vivante est un document Claude rattaché au compte personnel du porteur. Elle n'est lisible depuis le compte du destinataire que si Michel-Marie la partage ; sinon, `SPEC.md` (export du 16 octobre 2026) fait foi.
