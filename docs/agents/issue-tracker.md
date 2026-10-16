# Tracker de tickets : GitHub

Les tickets et les specs de ce dépôt vivent dans les GitHub Issues de `linagora/qrg`. Toutes les opérations passent par la CLI `gh`.

## Conventions

- **Créer un ticket** : `gh issue create --title "..." --body "..."`. Utiliser un heredoc pour un corps sur plusieurs lignes.
- **Lire un ticket** : `gh issue view <number> --comments`, en filtrant les commentaires avec `jq` et en récupérant aussi les libellés.
- **Lister les tickets** : `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`, avec les filtres `--label` et `--state` adaptés.
- **Commenter un ticket** : `gh issue comment <number> --body "..."`
- **Poser ou retirer un libellé** : `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Fermer** : `gh issue close <number> --comment "..."`

Le dépôt se déduit de `git remote -v` ; `gh` le fait seul quand il tourne dans un clone.

## Les pull requests comme surface de triage

**PRs as a request surface: no.** _(Passer à `yes` si ce dépôt traite les PR externes comme des demandes de fonctionnalité ; `/triage` lit ce drapeau.)_

Quand le drapeau vaut `yes`, les PR suivent les mêmes libellés et états que les tickets, avec les équivalents `gh pr` :

- **Lire une PR** : `gh pr view <number> --comments`, et `gh pr diff <number>` pour le diff.
- **Lister les PR externes à trier** : `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`, puis ne garder que les `authorAssociation` valant `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` ou `NONE` (écarter `OWNER`, `MEMBER` et `COLLABORATOR`).
- **Commenter, étiqueter, fermer** : `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub partage une même numérotation entre tickets et PR : un `#42` seul peut désigner l'un ou l'autre. Lever l'ambiguïté avec `gh pr view 42`, puis `gh issue view 42` en repli.

## Quand un skill dit « publier sur le tracker »

Créer un ticket GitHub.

## Quand un skill dit « récupérer le ticket concerné »

Lancer `gh issue view <number> --comments`.

## Opérations de wayfinding

Utilisées par `/wayfinder`. La **carte** est un ticket unique, dont les tickets **enfants** sont les tâches.

- **Carte** : un ticket unique portant le libellé `wayfinder:map`, dont le corps tient les rubriques Notes / Decisions-so-far / Fog. `gh issue create --label wayfinder:map`.
- **Ticket enfant** : un ticket rattaché à la carte comme sous-ticket GitHub (`gh api` sur l'endpoint des sous-tickets). Là où les sous-tickets ne sont pas activés, ajouter l'enfant à une liste de tâches dans le corps de la carte et placer `Part of #<map>` en tête du corps de l'enfant. Libellés : `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Une fois pris, le ticket est assigné au développeur qui le mène.
- **Blocage** : les **dépendances natives** de GitHub, la représentation canonique, visible dans l'interface. Ajouter une arête avec `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, où `<blocker-db-id>` est l'**identifiant de base de données** numérique du ticket bloquant (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _ni_ le `#number` ni le `node_id`). GitHub expose `issue_dependencies_summary.blocked_by` (bloquants ouverts seulement, la barrière effective). Là où les dépendances ne sont pas disponibles, se replier sur une ligne `Blocked by: #<n>, #<n>` en tête du corps de l'enfant. Un ticket est débloqué quand tous ses bloquants sont fermés.
- **Requête de frontière** : lister les enfants ouverts de la carte (`gh issue list --state open`, limité aux sous-tickets ou à la liste de tâches de la carte), écarter ceux qui ont un bloquant ouvert (`issue_dependencies_summary.blocked_by > 0`, ou un ticket ouvert dans la ligne `Blocked by`) ou un assigné ; le premier dans l'ordre de la carte l'emporte.
- **Prise** : `gh issue edit <n> --add-assignee @me`, première écriture de la session.
- **Résolution** : `gh issue comment <n> --body "<answer>"`, puis `gh issue close <n>`, puis ajouter un pointeur de contexte (résumé et lien) à la rubrique Decisions-so-far de la carte.
