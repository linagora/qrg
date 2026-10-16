# Prototype jetable du lot 0

PROTOTYPE, à ne pas reprendre tel quel. Il a servi à la démonstration du lot 0 de QRG, validée le 16 octobre 2026 (`notes/lot0-note-de-decision.md`). Les décisions qu'il a permis de prendre sont dans `notes/SPEC.md`, et le lot 1 les réimplémente avec ses tests. Il sera capturé sur une branche jetable de `linagora/qrg` quand le dépôt existera.

Préparation : `npm ci --ignore-scripts` dans ce dossier. Les versions sont exactes, dont l'Agent SDK 0.3.263, celui de DSH 0.2.1-alpha.4.

`sh demo-export.sh <clone du pilote> <dossier neuf>` copie le pilote, y simule la fusion des zones sur la branche par défaut, ajoute une branche piégée, puis lance les scénarios d'export A, B1, B2 et C. Le pilote n'est que cloné.

`sh demo-sdk.sh <dossier préparé> [preflight auth confinement question reprise]` lance l'Agent SDK sous `env -i`, sur l'abonnement Claude, dans l'export C0. Chaque scénario vérifie le compte avant tout envoi et s'arrête au premier événement de limite autre que `allowed`. Hors `preflight`, les scénarios envoient des messages au modèle : ne les relancer qu'en respectant les règles du compte (`notes/HANDOFF.md`, section 6).

`journaux/` garde la sortie des exécutions SDK du 16 octobre 2026.
