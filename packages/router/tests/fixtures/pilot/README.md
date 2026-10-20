# Fixture du pilote

`tree/` est une copie réduite de [linagora/claude-delegate](https://github.com/linagora/claude-delegate) au commit `7f2c556`, publié sous AGPL-3.0 : son fichier `.linagora/sensitivity.yml`, recopié tel quel, et ses zones fictives `qrg_pilot/`, une par classe de C0 à C3, sans les `__pycache__`. Le `README.md` de sa racine est réécrit pour la copie. Tout y est fictif, et `qrg_pilot/README.md` décrit les zones et leurs canaris.

## Construire le dépôt

`buildPilotRepo(dir)`, dans `../pilot.ts`, copie `tree/` dans un répertoire vide et en fait un dépôt git tel qu'un clone le voit : `main` porte l'arbre du pilote et sert de branche par défaut distante, `refs/remotes/origin/main` pointant sur elle et `refs/remotes/origin/HEAD` sur cette référence, sans remote d'où récupérer quoi que ce soit. git y tourne sans la configuration de l'utilisateur ni celle du système, donc sans leurs hooks ni leur signature, et avec un auteur fixe.

Le dépôt rendu expose :

- `root`, sa racine, où `main` est extraite ;
- `git(...args)`, qui lance git dans le dépôt avec le même environnement ;
- `checkoutTrap()`, qui extrait la branche piégée ;
- `mergeIntoDefault()`, qui pointe la branche par défaut distante sur HEAD, comme le ferait la fusion de HEAD après revue ;
- `addSubmodule(path, files)`, qui commite en `path` un sous-module : un dépôt à part, sur sa propre `main`, fait des fichiers donnés et commité en place comme gitlink, sans `.gitmodules` ni remote ;
- `addToIndex(paths)`, qui ajoute à l'index seul, sans rien écrire dans l'arbre de travail, des chemins qui sont chacun une copie du `README.md` de la racine. Chaque chemin est donné en octets bruts : il peut donc ne pas être de l'UTF-8, ce que certains systèmes de fichiers refusent.

`runGit(dir, ...args)` lance git avec le même environnement dans un autre répertoire, comme un dépôt créé à part par un test.

Chaque test construit son dépôt dans un répertoire temporaire et le supprime ensuite, comme `../../sensitivity-class.test.ts`.

## Branche piégée

La branche `trap` (`TRAP_BRANCH`) part de `main` et réunit en un commit ce qu'une branche malveillante tenterait :

- elle abaisse la zone C3 `pilot-secnumcloud` en C0 dans `.linagora/sensitivity.yml` ;
- elle ajoute dans la zone C0 un lien symbolique vers le module C3, `qrg_pilot/c0_public/shortcut.py`, et un lien vers l'extérieur du dépôt, `qrg_pilot/c0_public/outside`, qui vise `/etc/hosts` ;
- elle suit un fichier `qrg_pilot/c0_public/.env`, qui porte son propre canari.

## Constantes

- `PILOT_CANARIES` : le canari de chaque zone au-dessus de C0, que contient le module de la zone.
- `TRAP_ENV_CANARY` : le canari du `.env` de la branche piégée.
- `PILOT_SENSITIVITY_SHA256` : l'empreinte SHA-256 de `tree/.linagora/sensitivity.yml`, à mettre à jour avec le fichier.

Les canaris ne figurent que dans `../pilot.ts` et dans des fichiers classés au-dessus de C0, jamais dans un fichier C0 de l'arbre, qui partirait avec chaque export. L'export, le filtre du texte de tâche et les scénarios de bout en bout les cherchent dans ce qui sort.
