#!/bin/sh
# PROTOTYPE jetable, lot 0 QRG : exécutions courtes de l'Agent SDK sur l'abonnement, dans l'export C0.
# Le parent repart sous env -i, comme un DSH démarré depuis un terminal propre : aucune variable de
# la session Claude Code ni de cmux, aucune clé, et un PATH sans le shim cmux.
# Usage : sh demo-sdk.sh <répertoire préparé par demo-export.sh> [scénario...]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
W=$1
shift
WS="$W/export-c0"
OUTSIDE="$W/hors-export/secret-fictif.txt"
[ -d "$WS/.git" ] && [ -f "$OUTSIDE" ] || { echo "export C0 ou fichier hors export absent : lancer demo-export.sh" >&2; exit 1; }
NODE_DIR=$(dirname "$(readlink -f "$(command -v node)")")
CLEAN_PATH="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
SCENARIOS=${*:-preflight auth confinement question reprise}

for s in $SCENARIOS; do
  printf '\n=== %s\n' "$s"
  env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" SHELL=/bin/zsh LANG="${LANG:-fr_FR.UTF-8}" \
    TMPDIR="$(getconf DARWIN_USER_TEMP_DIR)" TERM=xterm-256color PATH="$CLEAN_PATH" \
    node "$HERE/sdk-proto.mjs" "$s" "$WS" "$OUTSIDE"
  code=$?
  echo "code de sortie $code"
  case $code in
    2|3) echo "ARRÊT de la démonstration"; exit "$code" ;;
  esac
done
