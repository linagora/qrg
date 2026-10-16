#!/bin/sh
# PROTOTYPE jetable, lot 0 QRG : démonstration de l'export en une commande.
# Usage : sh demo-export.sh <dépôt pilote> <répertoire de travail neuf>
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$1
W=$2
sh "$HERE/setup-fixture.sh" "$SRC" "$W" || exit 1

printf '\n=== A. Pilote réel, tel quel : le fichier de sensibilité manque sur la branche par défaut\n'
node "$HERE/export.mjs" --repo "$SRC" --max-class C1 --out "$W/export-pilote-reel"
echo "code de sortie $?"

printf '\n=== B1. Copie avec fusion simulée, couple Claude Code (plafond C1)\n'
node "$HERE/export.mjs" --repo "$W/pilote" --max-class C1 --out "$W/export-c1"
echo "code de sortie $?"

printf '\n=== B2. Même copie, plafond C0 (espace des exécutions du SDK)\n'
node "$HERE/export.mjs" --repo "$W/pilote" --max-class C0 --out "$W/export-c0"
echo "code de sortie $?"

printf '\n=== C. Branche piégée, plafond C1\n'
git -C "$W/pilote" checkout -q demo/pieges
node "$HERE/export.mjs" --repo "$W/pilote" --max-class C1 --out "$W/export-pieges"
echo "code de sortie $?"
git -C "$W/pilote" checkout -q main
