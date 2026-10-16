# Note de décision du lot 0

16 octobre 2026. Destinataire : Michel-Marie Maudet, porteur et Security Officer. Statut : validée le 16 octobre 2026.

Cette note clôt le lot 0 de QRG, dont le critère de sortie est sa validation. Elle dit ce qui est décidé, ce que l'étude a changé au plan, les risques qui restent et ce que livre le lot 1. `notes/SPEC.md` fait foi pour le détail ; les quatre notes du lot 0 renvoient au code de DSH.

## Ce qui est décidé

Les treize arbitrages du 15 octobre fixent le périmètre. Claude Code reste accessible par les abonnements individuels des développeurs, sans que QRG lise ni relaie leurs identifiants, et LINAGORA forke en open source le fournisseur Claude Code de DSH. Le routage enchaîne des règles, un juge Qwen local, puis Jev, appelé pour C0 et C1 seulement et désactivé tant que le contrat de TypeSafe AI n'est pas validé. La classe de sensibilité, de C0 à C3, est calculée depuis `.linagora/sensitivity.yml`, jamais par un modèle, et les tâches C2 et C3 ne quittent pas les modèles hébergés par LINAGORA. Le compteur mesure les tokens Claude évités. Paperclip, Decision 3.0 et Laya sont hors jeu.

Les neuf arbitrages du 16 octobre répondent au second passage de l'étude. Le profil `qrg` coupe tous les flux que DSH envoie par défaut à DeepSeek, qui n'est plus servi que par l'AI Gateway, sur des poids hébergés par LINAGORA. Le modèle de tête, hébergé par LINAGORA, est revérifié à chaque requête de la racine. Le fournisseur `fork` est retiré et le texte de chaque tâche est filtré avant toute sortie. Les questions des enfants sont posées dans le tour de la racine, et la reprise de Claude Code est une nouvelle exécution avec `resume`, portée par QRG. Une clé API factice n'est admise que dans les tests automatisés, confinée au processus enfant. Profils et bundles suivent le régime des plugins : revue, gel sur un commit, empreinte vérifiée. Le code vivra dans un monorepo `linagora/qrg` sous AGPL-3.0, les deux forks gardant leur licence. DSH est épinglé en 0.2.1-alpha.4 : la 0.2.0-rc.2, publiée en `latest`, n'a ni `startActivation` avec `cwd` et `agentPreset`, ni `appendPluginRecord`, ni la vérification d'`engines.dsh`.

Quatre arbitrages du même jour suivent la démonstration. L'enfant Claude Code n'hérite de rien du poste : le fork passe `settingSources: []` et `strictMcpConfig: true` et ne reçoit que les plugins revus qu'on lui donne, ce qui l'avance au lot 1. Le fichier de sensibilité n'est jamais exporté. Les transcriptions des sessions reprises restent sur le poste, comme une session ordinaire. Le format des motifs refuse un `**` qui n'occupe pas un segment entier et les caractères `[`, `]`, `{`, `}` et `\`.

## Ce que l'étude a changé

Le hand-off supposait qu'un fork du fournisseur Claude Code suffirait à faire tourner grill-me. Il est nécessaire mais pas suffisant, et plusieurs comportements par défaut de DSH vont contre nos règles. Cinq constats ont modifié le plan.

DSH envoie par défaut à DeepSeek tout le journal de la session, jusqu'à 8 Mio joints à chaque requête vers la route officielle, ainsi que l'inventaire des plugins et de la télémétrie, et lui confie le modèle de tête et la recherche web. Sans profil dédié, une zone C3 lue par la tête partirait chez DeepSeek avant tout routage.

DSH traite tout fournisseur externe comme ponctuel et refuse qu'un agent délégué interroge l'utilisateur (`DELEGATED_CALLER`). La reprise des sessions Claude Code et le relais des questions deviennent donc des fonctions de QRG, et non du seul fork.

Un enfant lit tout son répertoire de travail et, dans un worktree, tout l'historique. La classe d'une tâche porte donc sur ce que l'enfant peut lire, et un enfant servi hors de LINAGORA, Claude Code en premier, travaille dans un export sans historique dont il rend un patch. L'export entre au lot 1.

Deux voies échappent au calcul par chemins : le fournisseur `fork`, qui transmet toute la conversation du parent à un modèle quelconque, et le texte de la tâche, rédigé par une tête qui a pu lire une zone C3.

Enfin, DSH ne permet pas de verrouiller une ligne de configuration, et l'échec d'un plugin n'arrête pas le démarrage. Nos interdictions sont donc appliquées par `qrg-router`, qui refuse de déléguer quand la configuration les enfreint, et pas seulement par le profil.

L'audit des six plugins candidats en retient un comme base (`loongsuite/dsh-plugin`, forké en `qrg-otel`), en reprend un en partie (`dsh-observe`) et écarte les quatre autres. DSH n'émettant aucune trace, QRG apporte son traceur.

## Risques

Les API d'une alpha ne sont pas stables. La version est épinglée exactement, et un job CI rejoue la suite QRG contre chaque nouvelle alpha.

La paraphrase d'un contenu C2 ou C3 par la tête, dans le texte d'une tâche, échappe au filtre, qui ne voit que les canaris et les extraits verbatim. C'est le risque résiduel accepté le 16 octobre.

Une couche de configuration de l'utilisateur peut rétablir une ligne coupée. `qrg-router` le détecte et refuse de déléguer, mais je n'ai pas vérifié qu'il puisse empêcher DSH d'émettre lui-même la télémétrie ou la recherche web rétablies. Le test S-06, qui attend une capture réseau vide, est donc à revoir au début du lot 1. Piste : le patch posé par `DSH_TELEMETRY_DISABLED` s'applique après toutes les couches (`packages/boot/app-boot/src/profile-context.ts:74-84`) ; reste à vérifier qu'il suffit.

Le fournisseur officiel lance Claude Code avec la configuration du poste du développeur : l'enfant reçoit ses plugins, ses hooks et ses connecteurs claude.ai. Le fork minimal, avancé au lot 1, coupe cet héritage. En `dontAsk`, la démonstration montre qu'il ne peut ni lire hors de l'export ni lancer `cat` par Bash sans règle d'autorisation ; je n'ai pas testé l'appel d'un connecteur. En `bypassPermissions`, que le fournisseur officiel admet, aucune vérification ne s'applique. L'authentification, en revanche, n'est plus un risque : le nettoyage de DSH exclut `CLAUDE_CODE_OAUTH_TOKEN` (`packages/subprocess/subprocess/src/index.ts:47, 66-80`), et la démonstration montre que la connexion stockée du compte suffit.

Les conditions d'Anthropic couvrent l'usage interne : les plafonds Pro et Max « assume ordinary, individual usage of Claude Code and the Agent SDK » ([source](https://code.claude.com/docs/en/legal-and-compliance)). L'offre commerciale du lot 4 est moins nette. La documentation du SDK dit : « Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK » ([source](https://code.claude.com/docs/en/agent-sdk/overview)), alors que la page de conformité admet qu'un utilisateur final se connecte avec son propre abonnement au binaire Claude Code non modifié, hébergé par une plateforme. L'option « abonnement » de l'offre est à faire confirmer par Anthropic avant le lot 4.

Le miroir des questions dans le journal de session par `appendPluginRecord` repose sur une API expérimentale dont la conservation n'est pas garantie ; le stockage QRG reste la source. Enfin, seule l'AI Gateway est accessible : aucun Langfuse ni Grafana ne peut encore recevoir les traces.

## Démonstration du lot 0

Deux scripts jetables la rejouent, hors de tout dépôt : `demo-export.sh` pour la classification et l'export, `demo-sdk.sh` pour l'Agent SDK. Ils seront capturés sur une branche jetable de `linagora/qrg` quand le dépôt existera.

L'export a été vérifié sur une copie du pilote. Le script lit les deux versions de `.linagora/sensitivity.yml`, celle de la branche par défaut et celle de l'arbre de travail, applique les motifs intégrés et suit les liens symboliques. Il écrit ensuite les blobs du commit courant dans un dépôt neuf à un seul commit, sans hooks ni signature, et contrôle cinq preuves : aucun historique, aucun fichier non suivi, aucun canari au-dessus du plafond, aucun contenu exclu recopié, et la classe de l'espace obtenu. Sur le pilote tel quel, le fichier manque sur la branche par défaut : les 87 chemins passent en C3 et l'export est refusé. Sur la copie où la fusion est simulée, les 102 chemins se répartissent en 93 C0, 3 C1, 3 C2 et 3 C3 ; l'export au plafond C1 garde 96 fichiers, celui au plafond C0 en garde 93, et les cinq preuves passent dans les deux cas. Sur une branche piégée, l'abaissement de la zone C3 en C0 est ignoré pour ses trois fichiers, et le `.env` suivi, le lien qui sort du dépôt et le lien vers un fichier C3 sont exclus.

Le premier passage a échoué sur la preuve des canaris, par ma faute : en créant la fixture, j'avais écrit les valeurs des canaris C1 à C3 dans `qrg_pilot/README.md`, un fichier C0. Le README nomme désormais les fichiers qui portent les canaris, sans leurs valeurs, et le second passage est conforme.

Deux points de l'export ont été tranchés le 16 octobre. L'export contenait `.linagora/sensitivity.yml`, qui nomme les zones exclues et leurs étiquettes (`client:acme`, `secnumcloud`, `personal-data`) : il n'est plus jamais exporté. Le calcul refusait aussi deux formes que `notes/lot0-sensibilite.md` ne définissait pas, un `**` qui n'occupe pas un segment entier et les caractères `[`, `]`, `{`, `}` et `\` : le format les refuse désormais, et un motif refusé ferme par défaut.

L'Agent SDK a tourné comme dans le fournisseur officiel. Le parent repart sous `env -i`, avec HOME, USER, LOGNAME, SHELL, LANG, TMPDIR, TERM et un PATH sans le shim cmux, comme un DSH lancé depuis un terminal. Le script applique la règle de nettoyage de DSH et les options de `run.ts:325-376`, plus un plafond de 8 tours et les événements de hooks dans le flux. Avant tout message au modèle, il vérifie le compte par `accountInfo()` : Claude Max, `firstParty`, aucune clé d'API, le même compte que `~/.claude.json`, palier `default_claude_max_20x`, usage supplémentaire désactivé. Cinq sessions courtes ont tourné sur Haiku 4.5, avec le Claude Code 2.1.263 du SDK, dans l'export C0. Chaque événement de limite valait `allowed`, sans dépassement.

L'authentification fonctionne dans l'environnement expurgé : la connexion stockée dans le trousseau suffit.

Le fournisseur officiel ne fixe pas `settingSources`, et l'enfant charge donc toute la configuration du poste. Dans la démonstration, il a reçu 7 plugins et 86 skills, ainsi que le connecteur claude.ai Claude Docs et ses 8 outils. Le hook `guard.py` de l'utilisateur a tourné avant chaque Read et chaque Bash, et ses trois hooks Stop, dont la notification ntfy.sh, à chaque fin de session. Avec `settingSources: []` et `strictMcpConfig: true`, l'enfant ne charge ni plugin ni serveur MCP ; si l'option `plugins` lui donne en plus `mattpocock-skills`, il ne charge que ce plugin, grill-me compris. Ces trois vérifications n'envoient aucun message au modèle. Les options du fournisseur officiel sont fixées dans `claudeQueryOptions` : seul le fork peut les changer.

Le confinement à l'export tient en `dontAsk`. Read hors de l'export et `cat` par Bash sont refusés par Claude Code lui-même, sans consulter `canUseTool`, et le canari du fichier hors export n'atteint pas le modèle. Ce confinement dépend donc du mode : selon la documentation du SDK, `bypassPermissions` lève toute vérification. Le message de refus invite en outre le modèle à essayer d'autres outils. Je n'ai pas vérifié quelles commandes Bash `dontAsk` admet dans l'export, ni donc si l'enfant peut y lancer des tests.

`AskUserQuestion` passe par `canUseTool`, même en mode `plan`. La réponse, rendue après 75 s, arrive par `updatedInput.answers`, indexée par le texte de la question, et le modèle la suit. Le fork doit donc laisser cet outil actif et confier la réponse au relais `qrg-ask`.

La reprise fonctionne. Avec `persistSession: true`, la session est écrite dans `~/.claude/projects/<répertoire>/<session>.jsonl`, 89 Ko après un tour, et `resume` restitue le contexte sous le même identifiant. Avec `persistSession: false`, réglage du fournisseur officiel, rien n'est écrit, ce que confirment les trois autres sessions. Reprendre une session suppose donc de garder sa transcription sur le poste.

## Lot 1

Le lot 1 livre le profil `qrg` (flux vers DeepSeek coupés, tête hébergée par LINAGORA, `fork` retiré) et `qrg-router` : politique à règles, calcul de sensibilité, filtre du texte de tâche, export sans historique, outils `route_and_delegate` et `explain_route`. Les agents natifs passent par la gateway avec un modèle toujours explicite ; Claude Code passe en mode ponctuel par un fork minimal du fournisseur officiel, qui n'hérite de rien du poste et ne reçoit que les plugins revus, une instance par modèle et par mode, en `plan` ou `dontAsk`. Les traces passent par `qrg-otel`, et la pastille `qrg-meter` affiche la consommation réelle.

Démonstration attendue sur claude-delegate : une tâche de documentation C0 part vers Qwen, une spécification ambiguë part vers Claude Code, une tâche en zone C3 ne quitte pas l'infrastructure LINAGORA, et la pastille affiche les tokens. Critère de sortie : une tâche routée et tracée de bout en bout, avec D-01 à D-17 (hors lot 3), L-01, L-02, L-08, L-12, S-01 à S-04, S-06 à S-08 et E-06 au vert en intégration continue.

Quatre préalables, chacun sur accord explicite : créer `linagora/qrg` sur GitHub ; injecter les identifiants de la gateway sans qu'ils passent par une session Claude, par une étape guidée (une variable `LITELLM_API_KEY` est aujourd'hui définie dans `~/.zshrc`, donc visible des sessions Claude Code lancées depuis zsh) ; choisir et monter la cible des traces ; publier le fichier de sensibilité du pilote sur sa branche par défaut. Tant que `.linagora/sensitivity.yml` manque sur `main` de `linagora/claude-delegate`, la règle de fermeture par défaut classe tout le pilote en C3, et aucune de ses tâches ne peut partir vers Claude Code.

## Validation

16 octobre 2026 : validée par Michel-Marie Maudet, sans réserve. Le lot 0 est clos.
