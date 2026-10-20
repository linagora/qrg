# QRG

Routage agent/modèle et interaction utilisateur pour [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). La spécification qui fait foi est [`notes/SPEC.md`](notes/SPEC.md).

## Contenu du dépôt

Monorepo en workspace pnpm :

- `packages/router` (`@linagora/qrg-router`) : plugin DSH scindé en deux lignes. La ligne d'outils `@linagora/qrg-router/tools`, insérée dans les presets d'agent, expose `route_and_delegate` et refuse un TaskDescriptor invalide. La ligne hôte décide où la tâche s'exécute, la confie à un agent DSH natif et l'inscrit dans le registre QRG, le domaine de stockage DSH `qrg_router`. Tant que la politique à règles n'est pas branchée, la décision se réduit à son repli : un agent natif sur le modèle de repli de la gateway.
- `packages/bundle` (`@linagora/qrg-bundle`) : bundle de profil DSH. Son `cordis.patch.yml` déclare la route `linagora` de la LINAGORA AI Gateway, qui ne nomme que la variable de sa clé (`LINAGORA_API_KEY`), monte la ligne hôte et insère la ligne d'outils dans les presets `standard` et `ptc`.
- `scripts/` : outillage des tests transverses et de la CI, dont le canari DSH.
- `tests/` : tests transverses (épinglage de DSH, chaîne d'approvisionnement, canari).

Les sources sont en TypeScript et DSH les charge telles quelles, par le type stripping de Node, sans étape de build. Node refuse ce mode sous `node_modules` : installer le bundle comme dépendance demandera un build.

## Prérequis

- Node `^22.19.0 || >=24.0.0`, comme DSH.
- pnpm 11.28.5, fixé par `packageManager` (`corepack enable`, ou `pnpm/action-setup` en CI).

## Vérifications

```sh
pnpm install
pnpm check
```

`pnpm check` enchaîne le typage strict (`pnpm typecheck`, tsc), le lint (`pnpm lint`, oxlint, avertissements bloquants) et les tests (`pnpm test`, Vitest). Chaque étape se lance seule, et un fichier de test avec `pnpm vitest run <fichier>`. Le workflow `CI` lance `pnpm install --frozen-lockfile` puis `pnpm check` sur chaque pull request et sur `main`.

Le test de composition (`packages/bundle/tests/composition.test.ts`) lance le vrai `dsh` 0.2.1-alpha.4 installé dans `node_modules`, sur un profil temporaire tiré du gabarit `web` auquel le bundle QRG est lié, et vérifie que les deux lignes de `qrg-router` sont actives. Le processus démarre sans clé de modèle et sans télémétrie.

Le test de délégation (`packages/bundle/tests/delegation.test.ts`) lance le même `dsh` contre une fausse gateway locale, avec une fausse clé confinée au processus enfant. Il vérifie que `route_and_delegate` est exposé, qu'un TaskDescriptor invalide est refusé sans délégation, que l'enfant reçoit le modèle décidé même après un changement du modèle par défaut, et que le registre garde une entrée par délégation, échec compris, sans le texte de la tâche.

## Épinglage de DSH

QRG vise DSH 0.2.1-alpha.4, épinglée exactement : les API d'une alpha ne sont pas stables, et DSH saute au démarrage, sans erreur, un bundle dont `engines.dsh` ne couvre pas sa version. Toutes les dépendances `@deepseek-ai/dsh*` et tous les `engines.dsh` portent donc la même version exacte, ce que vérifie `tests/dsh-pin.test.ts`.

**Toute montée de DSH relève `engines.dsh` dans le même changement**, avec :

- les `engines.dsh` de `packages/router` et de `packages/bundle` ;
- toutes les dépendances `@deepseek-ai/dsh*` ;
- `@deepseek-ai/cordis` et `@deepseek-ai/cordis-plugin-loader`, alignés sur les versions que déclare la nouvelle version de `@deepseek-ai/dsh` ;
- `zod` et `@deepseek-ai/schemastery` dans `packages/router`, alignés sur les versions que déclare la nouvelle version de `@deepseek-ai/dsh-storage-domain` : le schéma zod du registre doit être celui qu'attend `domainTable`, sinon tsc le refuse ;
- les copies des presets `standard` et `ptc` dans `packages/bundle/cordis.patch.yml`, que `packages/bundle/tests/presets.test.ts` compare aux presets installés ;
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
