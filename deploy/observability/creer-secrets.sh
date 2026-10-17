#!/bin/sh
# Crée les Secrets `langfuse` et `qrg-otel-collector` avant l'installation, avec
# des valeurs aléatoires qui ne s'affichent jamais et ne passent pas par la
# ligne de commande.
#
# À lancer dans un terminal ordinaire, hors de toute session Claude, avec un
# kubectl pointé sur le cluster cible :
#
#   sh deploy/observability/creer-secrets.sh [namespace]
#
# Le namespace vaut `langfuse` par défaut. Le script refuse de toucher à des
# Secrets existants : régénérer le sel, la clé de chiffrement ou les mots de
# passe d'une instance en service la casserait.
set -eu

NS="${1:-langfuse}"
KUBECTL="${KUBECTL:-kubectl}"

for name in langfuse qrg-otel-collector; do
  if "$KUBECTL" -n "$NS" get secret "$name" >/dev/null 2>&1; then
    echo "Le Secret $name existe déjà dans le namespace $NS : rien n'a été modifié." >&2
    exit 1
  fi
done

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
mkdir "$WORK/langfuse" "$WORK/collector"

# Écrit une valeur dans le fichier qui porte le nom de sa clé, sans fin de ligne.
put() {
  printf '%s' "$3" > "$WORK/$1/$2"
}

hex() {
  openssl rand -hex "$1"
}

pg_password="$(hex 24)"
redis_password="$(hex 24)"
s3_user="langfuse"
s3_password="$(hex 24)"
public_key="pk-lf-$(hex 16)"
secret_key="sk-lf-$(hex 16)"

# Langfuse.
put langfuse salt "$(openssl rand -base64 32)"
put langfuse encryption-key "$(hex 32)"
put langfuse nextauth-secret "$(openssl rand -base64 32)"
put langfuse project-public-key "$public_key"
put langfuse project-secret-key "$secret_key"
put langfuse admin-password "$(hex 16)"

# Postgres : super-utilisateur, puis base et utilisateur de Langfuse.
put langfuse POSTGRES_USER postgres
put langfuse POSTGRES_PASSWORD "$(hex 24)"
put langfuse POSTGRES_DB langfuse
put langfuse USERDB_USER langfuse
put langfuse USERDB_PASSWORD "$pg_password"
put langfuse postgresql-password "$pg_password"

# ClickHouse.
put langfuse clickhouse-password "$(hex 24)"

# Valkey : la clé `default` porte le mot de passe de l'utilisateur ACL `default`.
put langfuse redis-password "$redis_password"
put langfuse default "$redis_password"

# SeaweedFS : identifiants S3 et configuration IAM qui les reprend.
put langfuse s3-user "$s3_user"
put langfuse s3-password "$s3_password"
put langfuse seaweedfs_s3_config "{\"identities\":[{\"actions\":[\"Admin\",\"Read\",\"Write\",\"List\",\"Tagging\"],\"credentials\":[{\"accessKey\":\"$s3_user\",\"secretKey\":\"$s3_password\"}],\"name\":\"$s3_user\"}]}"

# Collecteur : jeton d'écriture du poste et authentification Basic auprès de
# Langfuse, encodage base64 de `<clé publique>:<clé secrète>`.
put collector otlp-token "$(hex 32)"
put collector langfuse-auth "$(printf '%s:%s' "$public_key" "$secret_key" | openssl base64 -A)"

# Une substitution de commande qui échoue n'arrête pas le script : on refuse
# donc toute valeur vide avant de créer quoi que ce soit.
for file in "$WORK"/langfuse/* "$WORK"/collector/*; do
  if [ ! -s "$file" ]; then
    echo "Valeur vide pour la clé $(basename "$file") : rien n'a été créé." >&2
    exit 1
  fi
done

"$KUBECTL" -n "$NS" create secret generic langfuse --from-file="$WORK/langfuse" >/dev/null
"$KUBECTL" -n "$NS" create secret generic qrg-otel-collector --from-file="$WORK/collector" >/dev/null

echo "Secrets langfuse et qrg-otel-collector créés dans le namespace $NS."
