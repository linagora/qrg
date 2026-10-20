# Spécification de `.linagora/sensitivity.yml` (lot 0)

16 octobre 2026. Statut : règles de sécurité validées par le Security Officer le 16 octobre 2026 (dernière section), complétées le même jour pour deux voies qui ne passent pas par les chemins, puis après la démonstration du lot 0, et précisées le 18 octobre 2026 pour la classe que jugent les règles de routage ; l'implémentation du lot 1 a confirmé le format le 20 octobre 2026 et précisé le calcul les 20 et 21 octobre 2026 (section Précisions de l'implémentation), précisions que le Security Officer n'a pas encore validées.

## Rôle

Le fichier déclare la classe de sensibilité, de C0 à C3, de chaque chemin d'un dépôt. `qrg-router` en tire de façon déterministe la classe d'une tâche déléguée, puis retire les couples agent/modèle interdits avant tout appel au juge ou à Jev. Ni le texte de la tâche, ni l'orchestrateur, ni aucun modèle ne fixent la classe : le modèle de tête ne fournit que le périmètre estimé, et l'espace de travail de l'enfant reste la frontière (SPEC, composant 1).

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

La classe d'une tâche, celle que jugent les règles de routage, est le maximum des classes des chemins de son périmètre estimé dans le `TaskDescriptor`, où un répertoire vaut tous ses chemins et un périmètre vide le dépôt entier. Ce périmètre sert seulement à choisir le couple : il vient d'un modèle, il ne peut donc pas servir de frontière. La frontière est la classe de l'espace de travail, maximum des classes des chemins que l'enfant peut lire (section suivante), vérifiée juste avant le lancement (décision du 18 octobre 2026). Si l'appel de l'orchestrateur porte une classe plus basse que la classe calculée, elle est ignorée et la tentative est tracée (E-06).

## Ce que voit l'enfant

La spec initiale ne traitait pas ce point. Un agent lit tout son répertoire de travail et, dans un worktree Git, tout l'historique via `.git`. Prendre pour frontière les seuls fichiers visés par la tâche laisserait donc une tâche C0 lire une zone C3 voisine. Règle retenue :

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

## Précisions de l'implémentation

Le module `sensitivity` de `qrg-router` (ticket #6, 20 et 21 octobre 2026) suit cette note et la précise sur les points suivants. Ceux qui touchent à la classe vont dans le sens de la fermeture, à une exception près : un fichier non suivi n'entre dans le calcul que s'il est nommé (point « Chemins classés »). Le Security Officer ne les a pas encore validés.

- **Refus du format.** En plus des refus listés plus haut, le format refuse un motif vide, un segment vide (`a//b`, `/` final) ou `.`, un identifiant de zone hors kebab-case, une zone sans motif, et un YAML qui porte une clé en double, une étiquette de type, même standard comme `!!str` ou non spécifique comme `!`, une clé `__proto__`, que zod laisserait passer là où il refuse tout autre champ inconnu, ou un alias. La raison d'un refus ne cite jamais le contenu du fichier : seulement le code et la ligne de l'erreur YAML, ou le champ et la règle enfreinte.
- **Motifs.** Un motif couvre les chemins qu'il désigne et tout ce qui se trouve sous eux : `qrg_pilot/c1_internal` couvre `qrg_pilot/c1_internal/changelog.py`. `**` vaut zéro segment ou plus, si bien que `drafts/**` couvre aussi `drafts`. La comparaison porte sur la forme NFC du motif et du chemin, `?` y valant un caractère de cette forme : un nom en forme décomposée reste couvert par un motif écrit en forme composée, et inversement. Pour ignorer la casse, chaque caractère passe en minuscule, en majuscule puis de nouveau en minuscule, chaque étape n'étant retenue que si elle donne un seul caractère : `S`, `s` et `ſ` se valent, comme `Σ`, `σ` et `ς`. La même comparaison sert aux entrées du périmètre et aux sous-modules. Son coût reste borné par le produit des longueurs du motif et du chemin, quels que soient les `**` et `*` du motif : un motif piège ne bloque pas le calcul. Le coût total croît en revanche avec le nombre de motifs multiplié par le nombre de chemins atteints, et le format ne borne pas encore le nombre de motifs. Mesuré le 21 octobre 2026 sur un poste de développement : environ 13 ms par motif pour 100 000 chemins, soit une quarantaine de secondes pour une version de l'arbre de travail de 3 000 motifs.
- **Version de confiance.** À défaut de `refs/remotes/origin/HEAD`, la branche par défaut est `origin/main`, puis `origin/master`, puis les branches locales `main` et `master`. Une branche distante passe avant une branche locale, qui peut porter des commits qu'aucune revue n'a vus. Sans aucune de ces branches, la version de confiance manque et tout le dépôt passe en C3.
- **Repli d'une version.** Une version absente, invalide ou sans branche par défaut envoie tout le dépôt en C3, quels que soient les chemins que le périmètre atteint, même aucun. Les indicateurs de relèvement et d'abaissement ignoré ne sont posés que si les deux versions ont été lues : un fichier simplement supprimé de l'arbre de travail compte comme un repli, pas comme un relèvement.
- **Dépôt lu.** Le calcul lit toujours le dépôt de l'espace de travail : git y tourne sans les variables `GIT_*` du processus, dont `GIT_DIR`, qui lui feraient lire un autre dépôt, et sans `core.fsmonitor`, que la configuration du dépôt pourrait poser et qui ferait lancer un programme à git.
- **Chemins classés.** Ce sont ceux de l'index et ceux du commit HEAD, plus ceux que le périmètre nomme : un chemin retiré de l'index mais encore présent dans HEAD reste classé, et un fichier non suivi n'entre dans le calcul que s'il est nommé, puisque ni le worktree ni l'export de l'enfant n'en contiennent. Le périmètre est relatif à l'espace de travail, et un périmètre vide vaut le dépôt entier, même depuis un sous-répertoire. Une entrée vaut le chemin qu'elle nomme et tous les chemins suivis sous lui ; l'entrée `.` vaut le dépôt entier sans masquer les autres entrées, dont un fichier non suivi nommé à côté d'elle. Une entrée nomme un fichier ou un répertoire, jamais un motif : le `TaskDescriptor` refuse une entrée qui contient `*` ou `?`, que le calcul lirait comme un nom, laissant hors du calcul les fichiers que le motif désigne.
- **Chemins illisibles.** Un index illisible, un commit HEAD que la référence nomme mais que le dépôt ne contient pas, la cible illisible d'un lien suivi, comme une erreur imprévue du calcul, envoient tout le dépôt en C3. Sans commit HEAD, sur une branche encore vide, l'index liste seul les chemins suivis ; une référence HEAD corrompue, que git lui-même traite comme une branche vide, est lue de la même façon. Un chemin suivi dont le nom n'est pas de l'UTF-8 vaut C3, comme le chemin que désigne son nom décodé : ce nom ne désigne pas le fichier, dont les liens ne peuvent donc pas être suivis.
- **Liens symboliques.** Un chemin est classé aussi par la cible que nomme son lien et par son chemin réel, une fois tous les liens résolus, ce qui couvre un chemin qui traverse un lien de répertoire. Les liens que git enregistre, dans l'index ou dans HEAD, sont suivis de même jusqu'à la cible qu'il en garde, même quand l'arbre de travail ne contient plus le lien ou l'a remplacé par un fichier, et un chemin sous un tel lien de répertoire est classé aussi sous sa cible. Un lien vers un répertoire vaut tous les chemins suivis de ce répertoire. Un lien absolu vaut C3 même s'il vise le dépôt, car depuis un export il viserait le dépôt de l'utilisateur, de même qu'une cible enregistrée qui n'est pas de l'UTF-8 ; une boucle de liens vaut C3, et 40 liens suivis l'un après l'autre comptent pour une boucle.
- **Sous-modules.** Les chemins d'un sous-module sont classés par les deux versions de son propre fichier, celle de sa branche par défaut et celle de son arbre de travail, et par les zones du dépôt qui le contient. Un sous-module qui n'est pas extrait vaut C3, de même qu'un lien qui sort du sous-module, même vers le dépôt parent.
- **Preuves.** Elles portent les identifiants des zones touchées, préfixés du chemin du sous-module pour les siennes (`vendor/lib:zone`), leurs étiquettes, l'empreinte SHA-256 et la raison de repli éventuelle de chaque version de chaque fichier lu, la raison qui envoie tout un dépôt en C3 hors de son fichier, comme un index illisible, les indicateurs de relèvement et d'abaissement ignoré, et l'indicateur de repli que demande la section précédente, posé dès qu'un dépôt atteint vaut C3 en entier pour l'une de ces raisons. Pour une erreur imprévue, cette raison ne donne que le type de l'erreur, dont le message pourrait citer un chemin. Trois éléments que la section précédente ne prévoyait pas rendent explicable une classe C3 sans zone C3 : les motifs intégrés rencontrés, les chemins qui sortent du dépôt par un lien et les chemins dont le nom n'est pas de l'UTF-8, donnés avec des caractères de remplacement.

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

La PR #54 de `linagora/claude-delegate`, fusionnée sur sa branche par défaut le 17 octobre 2026 (`7f2c556`), ajoute `.linagora/sensitivity.yml` (défaut C0, le dépôt étant publié sous AGPL-3.0, et une zone par classe) et `qrg_pilot/`, qui contient par zone un petit module Python fictif avec ses tests, plus une ligne dans le tableau « Repository layout » du README. Chaque zone au-dessus de C0 porte un canari unique, recherché dans le journal de la gateway et dans la capture réseau des scénarios bout en bout : `qrg-canary-c1-1c880187`, `qrg-canary-c2-0f8e65d7`, `qrg-canary-c3-80792e6b`. Les 8 tests des zones et les 227 tests existants du dépôt passent.

## Décisions du Security Officer (16 et 18 octobre 2026)

Michel-Marie Maudet a retenu les quatre préconisations. Un dépôt sans fichier, ou dont le fichier est invalide, est traité entièrement en C3. Un enfant servi hors de l'infrastructure LINAGORA travaille dans un export sans historique et rend son travail sous forme de patch, ce qui fait entrer l'export dans le lot 1. Les motifs C3 intégrés sont ceux de la liste ci-dessus, sans `.env.*` ni `*.key`. Seule la version fusionnée sur la branche par défaut peut abaisser une classe, sans exigence de CODEOWNERS à ce stade.

Le même jour, il a retenu la fermeture des deux voies qui ne passent pas par les chemins : le fournisseur `fork` est retiré du profil et refusé par `qrg-router` vers un couple hors LINAGORA, et le texte de la tâche est filtré avant toute sortie par canaris et empreintes, la paraphrase restant un risque résiduel.

Après la démonstration du lot 0, il a retenu deux précisions : le fichier de sensibilité n'est jamais exporté, et le format refuse un `**` qui n'occupe pas un segment entier ainsi que les caractères `[`, `]`, `{`, `}` et `\`.

Le 18 octobre 2026, il a précisé la classe que jugent les règles de routage : celle du périmètre estimé, où un répertoire vaut tous ses chemins et un périmètre vide le dépôt entier, la classe de l'espace de travail restant la frontière vérifiée avant le lancement. Un périmètre sous-déclaré par le modèle de tête peut faire choisir Claude Code, qui ne reçoit alors qu'un export sans chemin C2 ni C3 ; le texte de la tâche reste filtré, et la paraphrase reste le risque résiduel accepté le 16 octobre.
