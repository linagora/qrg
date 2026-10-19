# QRG

Routage agent/modèle et interaction utilisateur pour [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). La spécification qui fait foi est [`notes/SPEC.md`](notes/SPEC.md).

## Contenu du dépôt

Monorepo en workspace pnpm :

- `packages/router` (`@linagora/qrg-router`) : plugin DSH scindé en deux lignes, la ligne hôte (moteur de décision, registre, appels aux sous-agents) et la ligne d'outils `@linagora/qrg-router/tools`, insérée dans les presets d'agent. Les deux sont encore vides.
- `packages/bundle` (`@linagora/qrg-bundle`) : bundle de profil DSH. Son `cordis.patch.yml` monte la ligne hôte et insère la ligne d'outils dans les presets `standard` et `ptc`.
- `scripts/` : outillage des tests transverses.
- `tests/` : tests transverses (épinglage de DSH).

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

## Épinglage de DSH

QRG vise DSH 0.2.1-alpha.4, épinglée exactement : les API d'une alpha ne sont pas stables, et DSH saute au démarrage, sans erreur, un bundle dont `engines.dsh` ne couvre pas sa version. Toutes les dépendances `@deepseek-ai/dsh*` et tous les `engines.dsh` portent donc la même version exacte, ce que vérifie `tests/dsh-pin.test.ts`.

**Toute montée de DSH relève `engines.dsh` dans le même changement**, avec :

- les `engines.dsh` de `packages/router` et de `packages/bundle` ;
- toutes les dépendances `@deepseek-ai/dsh*` ;
- `@deepseek-ai/cordis` et `@deepseek-ai/cordis-plugin-loader`, alignés sur les versions que déclare la nouvelle version de `@deepseek-ai/dsh` ;
- les copies des presets `standard` et `ptc` dans `packages/bundle/cordis.patch.yml`, que `packages/bundle/tests/presets.test.ts` compare aux presets installés ;
- le lockfile, par `pnpm install`.

## Chaîne d'approvisionnement

- Le délai de 24 h de pnpm 11 reste actif : en CI, un lockfile qui contient une version trop jeune fait échouer l'installation.
- Aucun script d'installation de dépendance ne s'exécute (`allowBuilds` dans `pnpm-workspace.yaml`). Les tests n'en ont pas besoin ; le postinstall de `@deepseek-ai/dsh-subprocess-local`, qui rend exécutable l'assistant de node-pty, ne sert qu'aux terminaux de DSH.

## Licence

QRG est publié sous AGPL-3.0 (`AGPL-3.0-only`, voir [`LICENSE`](LICENSE)). Les forks gardent la licence de leur projet d'origine : MIT pour `qrg-claude-code`, Apache-2.0 pour `qrg-otel`. Chacun conserve le fichier de licence et le champ `license` de son origine.
