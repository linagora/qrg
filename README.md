# QRG

Routage agent/modèle et interaction utilisateur pour [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). La spécification qui fait foi est [`notes/SPEC.md`](notes/SPEC.md).

## Contenu du dépôt

Monorepo en workspace pnpm :

- `packages/router` (`@linagora/qrg-router`) : plugin DSH scindé en deux lignes. La ligne d'outils `@linagora/qrg-router/tools`, insérée dans les presets d'agent, expose `route_and_delegate` et refuse un TaskDescriptor invalide. La ligne hôte décide où la tâche s'exécute par la politique de routage du profil (voir plus bas), l'inscrit dans le registre QRG, le domaine de stockage DSH `qrg_router`, puis la confie à l'agent retenu : au lot 1, seuls les agents DSH natifs s'exécutent. Le module `sensitivity` calcule, sans aucun modèle, la classe de sensibilité d'un périmètre à partir de `.linagora/sensitivity.yml`, comme le spécifie `notes/lot0-sensibilite.md`, et rend ses preuves sans contenu de fichier.
- `packages/bundle` (`@linagora/qrg-bundle`) : bundle de profil DSH et installation du profil `qrg`. Son `cordis.patch.yml` monte la ligne hôte, à qui il donne la route de la gateway et le nom de la politique du profil ; son `policy.yml` est la politique de routage par défaut. Son `profile.patch.yml` déclare la route `linagora` de la LINAGORA AI Gateway, qui ne nomme que la référence de sa clé (`LINAGORA_API_KEY`), y pointe le modèle de tête, coupe les flux que DSH envoie par défaut à DeepSeek, désactive le fournisseur `fork` et le preset `cordis`, retire `danger-full-access` des presets de permission et remplace le groupe `delegation` des presets `standard` et `ptc` par la ligne d'outils. Ce second fichier sert aussi de couche de patch au profil `qrg`, qui s'applique même quand DSH saute le bundle.
- `scripts/` : outillage des tests transverses et de la CI, dont le canari DSH.
- `tests/` : tests transverses (épinglage de DSH, chaîne d'approvisionnement, canari).

Les sources sont en TypeScript et DSH les charge telles quelles, par le type stripping de Node, sans étape de build. Node refuse ce mode sous `node_modules` : installer le bundle comme dépendance demandera un build.

## Prérequis

- Node `^22.19.0 || >=24.0.0`, comme DSH.
- pnpm 11.28.5, fixé par `packageManager` (`corepack enable`, ou `pnpm/action-setup` en CI).

## Profil `qrg`

```sh
pnpm install
pnpm qrg:install
pnpm qrg
```

`pnpm qrg:install` crée le profil dans `$DSH_HOME/profiles/qrg` (`~/.dsh` par défaut, comme dsh) : le gabarit `web` de DSH, le bundle QRG lié à ce checkout, une copie de `packages/bundle/profile.patch.yml` comme couche de patch du profil, et une copie de `packages/bundle/policy.yml`, `qrg-policy.yml`, comme politique de routage. Le profil se construit à côté et ne prend sa place qu'une fois complet : une installation interrompue ne laisse pas de profil partiel. Si le profil existe déjà, la commande s'arrête sans rien modifier.

`pnpm qrg` lance dsh sur ce profil avec `DSH_TELEMETRY_DISABLED=1` et lui passe ses arguments. Le profil ne porte que la référence de la clé de la gateway ; la clé elle-même se range dans le fichier d'identifiants de DSH, comme le décrit `notes/acces-lot1.md`. dsh travaille dans le répertoire courant, la racine du dépôt avec `pnpm qrg` : pour un autre projet, lancer `node <checkout>/packages/bundle/src/qrg.ts` depuis son répertoire.

Le profil n'est pas mis à jour avec le dépôt. Le lien vers le bundle vise l'emplacement du checkout, et la couche de patch est une copie que l'éditeur de réglages de DSH réécrit aussi. Après un déplacement du checkout, ou une mise à jour de QRG qui change `profile.patch.yml`, mettre l'ancien profil de côté, relancer `pnpm qrg:install` et reporter les réglages à garder. Un profil créé avant la politique de routage n'a pas de `qrg-policy.yml` : chaque délégation y échoue, faute de politique lisible, tant que `packages/bundle/policy.yml` n'y est pas copié sous ce nom.

## Politique de routage

La ligne hôte de `qrg-router` choisit l'agent de chaque délégation par la politique du profil, le fichier `qrg-policy.yml` de `$DSH_HOME/profiles/qrg`, et non le modèle de tête. Elle cherche ce nom dans le répertoire du profil que dsh lui fournit, jamais dans le répertoire de lancement ; hors d'un profil lancé par dsh, elle refuse un chemin relatif. Elle le relit à chaque délégation : une modification vaut pour la délégation suivante, sans relancer dsh. Un fichier illisible ou invalide fait échouer chaque délégation, avec son chemin et la raison.

Le fichier nomme des couples agent/modèle, chacun avec les classes de sensibilité qu'il admet et, s'il peut être forcé, sa mention (`qwen` pour `@qwen`), puis des règles et un repli ; `notes/SPEC.md` (composant 1) en donne un exemple. Une règle s'applique quand la tâche remplit toutes ses conditions `when` (classe, intention, interactivité) : une règle `allow` écarte les couples qu'elle ne nomme pas, une règle `route` envoie la tâche à un couple. La décision part des couples qui admettent la classe du périmètre de la tâche, que `qrg-router` calcule lui-même dans le répertoire de l'agent qui délègue, et chaque règle `allow` applicable les restreint. Un agent forcé par l'utilisateur passe avant toute règle s'il reste admis ; sinon la délégation est refusée avec la raison. À défaut, la première règle `route` applicable dont le couple reste admis tranche, puis le repli s'il reste admis lui aussi ; sinon la délégation est refusée. Le format refuse un couple autre qu'un agent natif qui admet C2 ou C3, un couple qui nomme deux fois une classe, et un repli qui n'admet pas les quatre classes.

La politique par défaut a deux couples : `native/qwen3.8`, le repli, et `claude-code/claude-opus`, qui n'admet que C0 et C1 et répond à `@claude`. Sa seule règle, `sensitive-stays-internal`, garde les tâches C2 et C3 sur la gateway ; aucune règle n'y route encore, et toute tâche que l'utilisateur ne force pas va au repli. Au lot 1, seuls les agents natifs s'exécutent : une décision vers Claude Code ou un agent ACP, comme `@claude` sur une tâche C0 ou C1, est inscrite au registre, puis la délégation échoue.

Chaque entrée du registre garde, outre l'intention, le périmètre, l'interactivité, la session enfant et l'issue, la classe du périmètre et ses preuves, la décision (couple, maillon qui a tranché, règle, forçage, couples admis et règles `allow` appliquées) ou le refus et sa raison, et les noms des champs de l'appel que le `TaskDescriptor` ne déclare pas, que la décision ignore. Les entrées écrites avant la politique restent lisibles.

## Vérifications

```sh
pnpm install
pnpm check
```

`pnpm check` enchaîne le typage strict (`pnpm typecheck`, tsc), le lint (`pnpm lint`, oxlint, avertissements bloquants) et les tests (`pnpm test`, Vitest). Chaque étape se lance seule, et un fichier de test avec `pnpm vitest run <fichier>`. Le workflow `CI` lance `pnpm install --frozen-lockfile` puis `pnpm check` sur chaque pull request et sur `main`.

Le test de composition (`packages/bundle/tests/composition.test.ts`) lance le vrai `dsh` 0.2.1-alpha.4 installé dans `node_modules`, sur le profil `qrg` tel que l'installation le crée dans un `DSH_HOME` temporaire, et vérifie que les deux lignes de `qrg-router` sont actives. Le processus démarre sans clé de modèle et sans télémétrie.

Le test du profil (`packages/bundle/tests/profile.test.ts`) lance le même profil sans `DSH_TELEMETRY_DISABLED` et avec `DSH_PERMISSION_MODE=danger-full-access`. Il vérifie qu'aucun plugin qui envoie des données à DeepSeek n'est actif, que la route de la gateway est la seule et porte le modèle de tête, que `fork` est désactivé, et que ni les presets de permission, ni le mode de sandbox par défaut, ni la politique d'approbation n'accordent `danger-full-access`. Il refait ces vérifications avec chaque copie des lignes seule : quand DSH saute le bundle QRG, hors plage de version, et quand la couche de patch du profil est vidée.

Le test de session (`packages/bundle/tests/session.test.ts`) fait tourner une session avec la fausse gateway sous une capture réseau, préchargée dans `dsh`, qui journalise chaque connexion TCP et chaque résolution de nom et refuse tout hôte hors boucle locale : aucune ne vise `deepseek.com` ni `deepseeksvc.com`.

Le test de `DSH_TELEMETRY_DISABLED` (`packages/bundle/tests/telemetry-switch.test.ts`) établit son effet face à une couche qui rallume la télémétrie, avec et sans le lanceur de `pnpm qrg` (S-06).

Le test d'installation (`packages/bundle/tests/install.test.ts`) exécute les scripts de `pnpm qrg:install` et de `pnpm qrg` sur un `DSH_HOME` temporaire. Il vérifie qu'un second lancement laisse le profil intact, qu'un répertoire de profil sans manifeste reste intact aussi, et que le lanceur ne démarre pas dsh sans profil.

Les tests de sensibilité (`packages/router/tests/sensitivity-file.test.ts` et `sensitivity-class.test.ts`) vérifient les refus du format puis le calcul de la classe sur la fixture du pilote, un vrai dépôt git construit dans un répertoire temporaire : les deux versions du fichier, les motifs intégrés, les zones chevauchantes, les liens symboliques, les sous-modules et la fermeture par défaut (D-11 à D-15), ainsi que la casse et la forme Unicode des noms, les noms hors UTF-8 et la durée du calcul face à un grand index ou à un motif piège. La fixture, que reprendront l'export, le filtre et les tests de bout en bout, est décrite dans `packages/router/tests/fixtures/pilot/README.md`.

Les tests de la politique (`packages/router/tests/policy.test.ts`) vérifient la décision, dont D-02, D-03 pour sa partie du lot 1, D-05 et D-07, les refus du format et la relecture du fichier à chaque décision (D-08), sur une politique de test (`fixtures/policy.ts`) que reprend le test de délégation. Le test du registre (`registry.test.ts`) vérifie que les entrées écrites avant la politique restent lisibles, et celui du chemin de la politique (`policy-path.test.ts`) qu'un chemin relatif est refusé hors d'un profil dsh. Le test de la configuration de la gateway (`packages/bundle/tests/gateway-config.test.ts`) vérifie aussi les décisions de la politique par défaut.

Le test de délégation (`packages/bundle/tests/delegation.test.ts`) lance le même `dsh` dans le dépôt pilote de la fixture des tests de sensibilité, contre une fausse gateway locale, avec une fausse clé confinée au processus enfant. Il vérifie que `route_and_delegate` est exposé, qu'un TaskDescriptor invalide est refusé sans délégation, qu'une tâche sans périmètre est jugée sur la classe du dépôt entier, qu'une injection plantée dans la zone C3, que la tête scriptée lit puis suit, ne change ni la classe ni la décision, le registre nommant les champs ignorés (E-06), que `@claude` est refusé avec sa raison sur une tâche C3 et décidé avant toute règle sur une tâche C0 (D-05), qu'une politique modifiée entre deux messages d'une session s'applique à la délégation suivante (D-08), que l'enfant reçoit le modèle décidé même après un changement du modèle par défaut, et que le registre garde une entrée par délégation, échec et refus compris, sans le texte de la tâche.

## Épinglage de DSH

QRG vise DSH 0.2.1-alpha.4, épinglée exactement : les API d'une alpha ne sont pas stables, et DSH saute au démarrage, sans erreur, un bundle dont `engines.dsh` ne couvre pas sa version. Toutes les dépendances `@deepseek-ai/dsh*` et tous les `engines.dsh` portent donc la même version exacte, ce que vérifie `tests/dsh-pin.test.ts`.

**Toute montée de DSH relève `engines.dsh` dans le même changement**, avec :

- les `engines.dsh` de `packages/router` et de `packages/bundle` ;
- toutes les dépendances `@deepseek-ai/dsh*` ;
- `@deepseek-ai/cordis` et `@deepseek-ai/cordis-plugin-loader`, alignés sur les versions que déclare la nouvelle version de `@deepseek-ai/dsh` ;
- `zod` et `@deepseek-ai/schemastery` dans `packages/router`, alignés sur les versions que déclare la nouvelle version de `@deepseek-ai/dsh-storage-domain` : le schéma zod du registre doit être celui qu'attend `domainTable`, sinon tsc le refuse ;
- les copies des presets `standard` et `ptc` dans `packages/bundle/profile.patch.yml`, que `packages/bundle/tests/presets.test.ts` compare aux presets installés ;
- la liste des lignes que `packages/bundle/profile.patch.yml` désactive, à comparer aux lignes de `@deepseek-ai/dsh-base` et de `@deepseek-ai/dsh-web-app` qui joignent DeepSeek, et la liste de plugins de `packages/bundle/tests/profile.test.ts` ;
- les configurations que `packages/bundle/profile.patch.yml` remplace en entier (`llm-pi-ai`, `agent-default-model`, `web`, `sandbox-policy`, `approval`, `permission`), à comparer à celles de `@deepseek-ai/dsh-base`, et la copie de la ligne de télémétrie de dsh-base dans `packages/bundle/tests/telemetry-switch.test.ts` ;
- le lockfile, par `pnpm install`.

## Canari DSH

Le workflow `DSH canary` rejoue `pnpm check` contre une version plus récente de DSH sans toucher à l'épinglage : `scripts/dsh-canary.ts` ajoute des `overrides` à la copie CI de `pnpm-workspace.yaml`, et le test de composition accorde au bundle et à `qrg-router` l'exemption de version exacte que donne `dsh plugin allow-version`. Le job tourne deux fois par jour, à chaque push sur `main` et à la demande. Son échec annonce une rupture sans bloquer la CI : ce n'est pas un check requis.

La version retenue est la plus récemment publiée, alpha, rc ou finale, parmi celles qui ont passé le délai de 24 h que pnpm 11 impose aux nouvelles versions (`minimumReleaseAge`). Son installation garde le mode strict du workspace (voir Chaîne d'approvisionnement). Si aucune version au moins aussi récente que l'épinglage n'a passé le délai, le job s'arrête sans rien rejouer.

## Chaîne d'approvisionnement

- Le délai de 24 h de pnpm 11 reste actif : en CI, un lockfile qui contient une version trop jeune fait échouer l'installation.
- `pnpm-workspace.yaml` règle `minimumReleaseAgeStrict` : là où le mode par défaut ajouterait seul au fichier une exemption pour une version trop jeune, pnpm demande un accord en terminal et échoue en CI. `tests/supply-chain.test.ts` vérifie ce réglage et refuse toute exemption d'un paquet `@deepseek-ai/*`.
- Aucun script d'installation de dépendance ne s'exécute (`allowBuilds` dans `pnpm-workspace.yaml`). Les tests n'en ont pas besoin ; le postinstall de `@deepseek-ai/dsh-subprocess-local`, qui rend exécutable l'assistant de node-pty, ne sert qu'aux terminaux de DSH.

## Licence

QRG est publié sous AGPL-3.0 (`AGPL-3.0-only`, voir [`LICENSE`](LICENSE)). Les forks gardent la licence de leur projet d'origine : MIT pour `qrg-claude-code`, Apache-2.0 pour `qrg-otel`. Chacun conserve le fichier de licence et le champ `license` de son origine.
