# Docs de domaine

Comment les skills d'ingénierie consomment la documentation de domaine de ce dépôt quand ils explorent le code.

## Avant d'explorer, lire

- **`CONTEXT.md`** à la racine du dépôt, ou
- **`CONTEXT-MAP.md`** à la racine s'il existe : il pointe vers un `CONTEXT.md` par contexte. Lire chacun de ceux qui touchent le sujet.
- **`docs/adr/`** : lire les ADR qui touchent la zone où l'on s'apprête à travailler. Dans un dépôt à plusieurs contextes, regarder aussi `src/<context>/docs/adr/` pour les décisions propres à un contexte.

Si l'un de ces fichiers n'existe pas, **continuer sans le signaler**. Ne pas relever leur absence, ne pas proposer de les créer d'avance. Le skill `/domain-modeling` (atteint par `/grill-with-docs` et `/improve-codebase-architecture`) les crée au fil de l'eau, quand des termes ou des décisions sont réellement tranchés.

## Structure des fichiers

Dépôt à un seul contexte (la plupart des dépôts) :

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Dépôt à plusieurs contextes (présence de `CONTEXT-MAP.md` à la racine) :

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← décisions valables pour tout le système
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← décisions propres au contexte
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Employer le vocabulaire du glossaire

Quand une production nomme un concept du domaine (titre de ticket, proposition de refactoring, hypothèse, nom de test), employer le terme tel que `CONTEXT.md` le définit. Ne pas glisser vers les synonymes que le glossaire écarte explicitement.

Si le concept voulu n'est pas encore dans le glossaire, c'est un signal : soit on invente un langage que le projet n'emploie pas (à reconsidérer), soit il y a un vrai manque (à noter pour `/domain-modeling`).

## Signaler les conflits avec un ADR

Si une production contredit un ADR existant, le dire explicitement plutôt que de passer outre en silence :

> _Contredit l'ADR-0007 (commandes en event sourcing), mais mérite d'être rouvert parce que…_
