# Spécification de `.linagora/sensitivity.yml` (lot 0)

16 octobre 2026. Statut : règles de sécurité validées par le Security Officer le 16 octobre 2026 (dernière section), complétées le même jour pour deux voies qui ne passent pas par les chemins, puis après la démonstration du lot 0 ; le format sera confirmé à l'implémentation du lot 1.

## Rôle

Le fichier déclare la classe de sensibilité, de C0 à C3, de chaque chemin d'un dépôt. `qrg-router` en tire de façon déterministe la classe d'une tâche déléguée, puis retire les couples agent/modèle interdits avant tout appel au juge ou à Jev. Ni le texte de la tâche, ni l'orchestrateur, ni aucun modèle n'interviennent dans ce calcul (SPEC, composant 1).

## Emplacement et version de confiance

Le fichier se trouve à la racine du dépôt, en `.linagora/sensitivity.yml`. À chaque décision, le routeur en lit deux versions : celle de la branche par défaut (`refs/remotes/origin/HEAD`, à défaut la branche par défaut locale), dite de confiance, et celle de l'arbre de travail. Pour chaque chemin, il retient la plus haute des deux classes. Une branche peut ainsi relever une classe immédiatement, mais un abaissement ne prend effet qu'une fois fusionné sur la branche par défaut, donc après revue ; claude-delegate applique déjà ce principe à son `CLAUDE.md` de confiance. Le fichier est relu à chaque décision, sans redémarrage, et l'empreinte des deux versions est tracée.

Si le fichier est absent ou invalide (YAML illisible, version, classe ou champ inconnus, identifiant de zone en double, motif refusé), le routeur ferme par défaut : tout le dépôt est traité en C3 et l'incident est tracé.

## Format, version 1

```yaml
version: 1
default: C0                 # classe de tout chemin suivi qu'aucune zone ne couvre
zones:
  - id: pilot-secnumcloud   # unique, en kebab-case
    class: C3
    paths: ["qrg_pilot/c3_secnumcloud/**"]
    labels: [secnumcloud, personal-data]   # facultatif
    description: Périmètre SecNumCloud fictif.  # facultatif
```

`version` et `default` sont obligatoires, `zones` est facultatif. Les motifs sont relatifs à la racine, avec `/` comme séparateur : `*` ne traverse pas `/`, `**` couvre toute profondeur et occupe un segment entier, `?` vaut un caractère. La négation `!`, les chemins absolus et `..` sont refusés, car une exclusion pourrait sortir silencieusement un fichier d'une zone sensible. Les caractères `[`, `]`, `{`, `}` et `\` le sont aussi, car chaque outil lit à sa façon une syntaxe que le format ne définit pas. La comparaison ignore la casse, ce qui ne peut qu'élargir une zone, jamais la réduire.

Les étiquettes (`labels`) qualifient une zone : la politique de routage peut s'en servir dans ses règles, et elles apparaissent dans les traces et dans `explain_route`. Elles n'abaissent jamais une classe.

## Calcul de la classe

La classe d'un chemin est le maximum de `default`, des classes de toutes les zones qui le couvrent et des motifs intégrés ci-dessous, calculé pour chacune des deux versions du fichier, dont on garde encore le maximum. Quand des zones se chevauchent, la plus haute l'emporte, jamais la dernière ni la plus précise : une zone C0 large ne peut pas déclasser un sous-arbre C3. Un lien symbolique est classé à la fois par son chemin et par sa cible ; un lien qui sort du dépôt vaut C3. Un sous-module est classé par son propre fichier, et en C3 s'il n'en a pas.

Quelques motifs sont C3 quel que soit le fichier, sans possibilité de les abaisser : `**/.env`, `**/.env.local`, `**/.env.*.local`, `**/*.pem`, `**/*.p12`, `**/*.pfx`, `**/id_rsa`, `**/id_ecdsa`, `**/id_ed25519`, `**/.netrc`.

La classe d'une tâche est le maximum des classes des chemins que l'enfant peut lire, c'est-à-dire de son espace de travail (section suivante). Le périmètre estimé dans le `TaskDescriptor` sert seulement à choisir le couple : il vient d'un modèle, il ne peut donc pas servir de frontière. Si l'appel de l'orchestrateur porte une classe plus basse que la classe calculée, elle est ignorée et la tentative est tracée (E-06).

## Ce que voit l'enfant

La spec initiale ne traitait pas ce point. Un agent lit tout son répertoire de travail et, dans un worktree Git, tout l'historique via `.git`. Calculer la classe sur les fichiers visés par la tâche laisserait donc une tâche C0 lire une zone C3 voisine. Règle retenue :

- Un enfant servi par un modèle hébergé par LINAGORA travaille dans un worktree, comme le prévoit la spec.
- Tout autre enfant (Claude Code, `acp:opencode`, DeepSeek hors LINAGORA, modèle sous contrat UE) travaille dans un export sans historique : `git archive` des seuls chemins suivis dont la classe est admise par le couple, dans un répertoire hors du dépôt, avec un `git init` et un commit initial. Jamais dans l'arbre de travail de l'utilisateur, où traînent des fichiers non suivis comme `.env`. Ses modifications reviennent sous forme de patch, appliqué après validation et seulement s'il ne touche que des chemins exportés. Le fichier `.linagora/sensitivity.yml` n'est jamais exporté, car il nomme les zones exclues et leurs étiquettes.
- Juste avant le lancement, le plugin vérifie que la classe maximale de l'espace matérialisé est admise par le couple ; sinon il refuse, trace le refus et se replie sur un couple interne.

Conséquence sur le lot 1 : le dépôt pilote contenant désormais une zone C3, une tâche n'y peut partir vers Claude Code que par un export. L'export entre donc dans le lot 1, faute de quoi la démonstration « spécification ambiguë vers Claude Code » est impossible.

## Voies qui ne passent pas par les chemins

Le calcul précédent ne voit que des fichiers. Deux voies font sortir du contenu sans que l'enfant lise un chemin ; elles sont fermées par décision du 16 octobre 2026.

- **Le fournisseur `fork` de DSH.** Monté par la base (`packages/bundle/base/cordis.patch.yml:367-368`), il donne à l'enfant toutes les étapes terminées de la conversation du parent et accepte un autre modèle (`packages/subagent/subagent-fork-in-process/src/index.ts:60-78`). Le profil `qrg` désactive cette ligne. Comme une couche de l'utilisateur peut la rétablir, `qrg-router` refuse aussi toute délégation héritant du contexte vers un couple hors LINAGORA, et trace le refus.
- **Le texte de la tâche.** Il est rédigé par le modèle de tête, qui a pu lire une zone C2 ou C3. Avant toute sortie vers un couple hors LINAGORA, `qrg-router` le compare aux canaris et à des empreintes des fichiers classés C2 ou C3 selon le calcul ci-dessus, pris dans leur état de l'arbre de travail, c'est-à-dire tel que la tête a pu les lire. Les empreintes portent sur des fenêtres de lignes normalisées, dont la taille sera fixée au lot 1. Une correspondance vaut refus tracé, sans contenu dans la trace. La paraphrase échappe à ce filtre et reste un risque résiduel.

## Traces et `explain_route`

Le span de décision porte la classe retenue, les identifiants des zones touchées, les empreintes des deux versions du fichier, un indicateur de relèvement par l'arbre de travail, un indicateur de repli (fichier absent ou invalide), le mode d'espace de travail (worktree ou export), les zones exclues de l'export et le résultat du filtre du texte de tâche (correspondance ou non). Aucun contenu de fichier n'y figure. `explain_route` restitue les mêmes éléments.

## Tests

Les tests D-02, D-10, D-11, E-02 et E-06 de la spec s'appuient sur ce fichier. Sept tests sont à ajouter :

| ID | Test | Résultat attendu | Lot |
| --- | --- | --- | --- |
| D-12 | Zone C3 abaissée en C0 sur une branche | Classe inchangée tant que la branche par défaut n'est pas modifiée ; tentative tracée | 1 |
| D-13 | Fichier absent, puis invalide | Dépôt traité en C3, incident tracé | 1 |
| D-14 | Zone C0 large contenant une zone C3 | Fichiers de la zone C3 classés C3 | 1 |
| D-15 | Lien symbolique d'un chemin C0 vers un fichier C3, puis hors du dépôt | C3 dans les deux cas | 1 |
| D-16 | Délégation héritant du contexte (fournisseur `fork`) vers un couple hors LINAGORA, ligne `fork` réactivée par une couche utilisateur | Refus tracé, aucune requête hors LINAGORA | 1 |
| D-17 | Texte de tâche contenant un canari, puis un extrait verbatim d'un fichier C2 ou C3, routé vers Claude Code | Refus tracé, aucune requête au faux serveur Anthropic | 1 |
| L-12 | Tâche du dépôt pilote routée vers Claude Code | L'export ne contient ni zone C2 ou C3, ni fichier de sensibilité, ni historique, ni fichier non suivi ; aucun canari C2 ou C3 dans les requêtes reçues par le faux serveur Anthropic | 1 |

## Dépôt pilote

Branche locale `qrg/sensitivity-zones` du clone de `linagora/claude-delegate`, ni commitée ni poussée. Elle ajoute `.linagora/sensitivity.yml` (défaut C0, le dépôt étant publié sous AGPL-3.0, et une zone par classe) et `qrg_pilot/`, qui contient par zone un petit module Python fictif avec ses tests, plus une ligne dans le tableau « Repository layout » du README. Chaque zone au-dessus de C0 porte un canari unique, recherché dans le journal de la gateway et dans la capture réseau des scénarios bout en bout : `qrg-canary-c1-1c880187`, `qrg-canary-c2-0f8e65d7`, `qrg-canary-c3-80792e6b`. Les 8 tests des zones et les 227 tests existants du dépôt passent.

## Décisions du Security Officer (16 octobre 2026)

Michel-Marie Maudet a retenu les quatre préconisations. Un dépôt sans fichier, ou dont le fichier est invalide, est traité entièrement en C3. Un enfant servi hors de l'infrastructure LINAGORA travaille dans un export sans historique et rend son travail sous forme de patch, ce qui fait entrer l'export dans le lot 1. Les motifs C3 intégrés sont ceux de la liste ci-dessus, sans `.env.*` ni `*.key`. Seule la version fusionnée sur la branche par défaut peut abaisser une classe, sans exigence de CODEOWNERS à ce stade.

Le même jour, il a retenu la fermeture des deux voies qui ne passent pas par les chemins : le fournisseur `fork` est retiré du profil et refusé par `qrg-router` vers un couple hors LINAGORA, et le texte de la tâche est filtré avant toute sortie par canaris et empreintes, la paraphrase restant un risque résiduel.

Après la démonstration du lot 0, il a retenu deux précisions : le fichier de sensibilité n'est jamais exporté, et le format refuse un `**` qui n'occupe pas un segment entier ainsi que les caractères `[`, `]`, `{`, `}` et `\`.
