# QRG

Routage agent/modèle et interaction utilisateur pour [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). La spécification qui fait foi est [`notes/SPEC.md`](notes/SPEC.md).

## Contenu du dépôt

Monorepo en workspace pnpm :

- `packages/router` (`@linagora/qrg-router`) : plugin DSH scindé en deux lignes. La ligne d'outils `@linagora/qrg-router/tools`, insérée dans les presets d'agent, expose `route_and_delegate` et refuse un TaskDescriptor invalide. La ligne hôte décide où la tâche s'exécute, la confie à un agent DSH natif et l'inscrit dans le registre QRG, le domaine de stockage DSH `qrg_router`. Tant que la politique à règles n'est pas branchée, la décision se réduit à son repli : un agent natif sur le modèle de repli de la gateway. Le module `sensitivity` calcule, sans aucun modèle, la classe de sensibilité d'un périmètre à partir de `.linagora/sensitivity.yml`, comme le spécifie `notes/lot0-sensibilite.md`, et rend ses preuves sans contenu de fichier.
- `packages/bundle` (`@linagora/qrg-bundle`) : bundle de profil DSH et installation du profil `qrg`. Son `cordis.patch.yml` monte la ligne hôte. Son `profile.patch.yml` déclare la route `linagora` de la LINAGORA AI Gateway, qui ne nomme que la référence de sa clé (`LINAGORA_API_KEY`), y pointe le modèle de tête, coupe les flux que DSH envoie par défaut à DeepSeek, désactive le fournisseur `fork` et le preset `cordis`, retire `danger-full-access` des presets de permission et remplace le groupe `delegation` des presets `standard` et `ptc` par la ligne d'outils. Ce second fichier sert aussi de couche de patch au profil `qrg`, qui s'applique même quand DSH saute le bundle.
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

`pnpm qrg:install` crée le profil dans `$DSH_HOME/profiles/qrg` (`~/.dsh` par défaut, comme dsh) : le gabarit `web` de DSH, le bundle QRG lié à ce checkout, et une copie de `packages/bundle/profile.patch.yml` comme couche de patch du profil. Le profil se construit à côté et ne prend sa place qu'une fois complet : une installation interrompue ne laisse pas de profil partiel. Si le profil existe déjà, la commande s'arrête sans rien modifier.

`pnpm qrg` lance dsh sur ce profil avec `DSH_TELEMETRY_DISABLED=1` et lui passe ses arguments. Le profil ne porte que la référence de la clé de la gateway ; la clé elle-même se range dans le fichier d'identifiants de DSH, comme le décrit `notes/acces-lot1.md`. dsh travaille dans le répertoire courant, la racine du dépôt avec `pnpm qrg` : pour un autre projet, lancer `node <checkout>/packages/bundle/src/qrg.ts` depuis son répertoire.

Le profil n'est pas mis à jour avec le dépôt. Le lien vers le bundle vise l'emplacement du checkout, et la couche de patch est une copie que l'éditeur de réglages de DSH réécrit aussi. Après un déplacement du checkout, ou une mise à jour de QRG qui change `profile.patch.yml`, mettre l'ancien profil de côté, relancer `pnpm qrg:install` et reporter les réglages à garder.

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

Le test de délégation (`packages/bundle/tests/delegation.test.ts`) lance le même `dsh` contre une fausse gateway locale, avec une fausse clé confinée au processus enfant. Il vérifie que `route_and_delegate` est exposé, qu'un TaskDescriptor invalide est refusé sans délégation, que l'enfant reçoit le modèle décidé même après un changement du modèle par défaut, et que le registre garde une entrée par délégation, échec compris, sans le texte de la tâche.

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
