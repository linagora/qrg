# Observabilité du lot 1

Ce dossier décrit la cible des traces du lot 1 : un Langfuse v4 auto-hébergé sur un cluster Kubernetes LINAGORA, derrière un collecteur OpenTelemetry qui ne laisse passer que des métadonnées. Les décisions correspondantes sont dans la section Décisions de `notes/SPEC.md` (16 et 17 octobre 2026) et le détail dans `notes/acces-lot1.md`, section Traces.

Aucun fichier de ce dossier ne contient de secret. Les deux Secrets Kubernetes se créent avant l'installation avec `creer-secrets.sh`, hors de toute session Claude.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `langfuse-values.yaml` | Valeurs du chart `langfuse/langfuse` |
| `collector-values.yaml` | Valeurs du chart `open-telemetry/opentelemetry-collector`, configuration du collecteur comprise |
| `creer-secrets.sh` | Crée les Secrets `langfuse` et `qrg-otel-collector` avec des valeurs aléatoires, sans les afficher |
| `verifier-collecteur.py` | Rend le chart du collecteur, valide sa configuration et contrôle son filtrage sur la machine locale |

## Versions

| Composant | Version |
| --- | --- |
| Chart `langfuse/langfuse` | 2.1.4, soit Langfuse 4.50.0 |
| Chart `open-telemetry/opentelemetry-collector` | 0.175.1 |
| Image du collecteur | `otel/opentelemetry-collector-contrib:0.161.0` |
| cert-manager | v1.20.2 |
| Opérateur ClickHouse | 0.0.5 |

Le chart Langfuse demande Helm 3.17 et Kubernetes 1.28 au moins.

## Chemin des traces

1. Le poste exporte en OTLP/HTTP vers `https://otlp.example.com/v1/traces`, avec l'en-tête `Authorization: Bearer <jeton du poste>`.
2. L'ingress termine TLS et ne transmet que ce chemin au collecteur, qui refuse toute requête sans le bon jeton (réponse 401).
3. Le collecteur retire tout contenu, puis exporte vers Langfuse à l'intérieur du cluster, sur `http://langfuse-web.langfuse.svc.cluster.local:3000/api/public/otel`, avec la paire de clés du projet `qrg` en authentification Basic et l'en-tête `x-langfuse-ingestion-version: 4`.

Seul le collecteur détient la paire de clés Langfuse. Le poste ne connaît que son jeton d'écriture.

## Ce que le collecteur retire

Cette seconde barrière s'ajoute à `qrg-otel` (#9), prévu pour ne capturer aucun contenu. Le collecteur :

- abandonne tous les événements de span, qui peuvent porter les prompts, les détails d'inférence et les exceptions ;
- vide le message de statut des spans, qui porte le texte des erreurs, et garde leur code ;
- retire les liens de span et les attributs de portée ;
- réduit les attributs de ressource à `service.name`, `service.version` et `telemetry.sdk.*` ;
- supprime tout attribut de span absent de la liste autorisée de `collector-values.yaml`, qui ne contient que des métadonnées : opération, modèle, usage en tokens, identifiants de session, de tour et d'appel d'outil, nom de l'outil, type d'erreur ;
- masque, dans les valeurs gardées, ce qui a la forme d'une clé `sk-…`, d'un jeton GitHub ou d'un JWT.

Une erreur d'évaluation dans `filter` ou `transform` abandonne le lot de traces au lieu de le laisser passer. La liste autorisée suit les attributs émis par `@loongsuite/otel-util-genai` 0.1.1 et dsh-plugin ; les attributs propres à QRG s'y ajouteront avec #20. Le processeur `redaction` filtre aussi les attributs de ressource : les clés de ressource gardées doivent donc figurer dans sa liste.

## Prérequis sur le cluster

- Une classe d'ingress par défaut, ou une classe à indiquer dans les deux fichiers de valeurs, et de quoi produire les certificats TLS des deux noms DNS.
- Une StorageClass par défaut. Les volumes demandés totalisent environ 200 Gi : ClickHouse 100 Gi, SeaweedFS 50 Gi, Postgres 20 Gi, Keeper 20 Gi, Valkey 8 Gi.
- cert-manager et l'opérateur ClickHouse, qu'exige le chart Langfuse :

  ```sh
  helm install cert-manager oci://quay.io/jetstack/charts/cert-manager --version v1.20.2 \
    --namespace cert-manager --create-namespace --set crds.enabled=true
  kubectl wait --for=condition=Established \
    crd/certificates.cert-manager.io crd/issuers.cert-manager.io --timeout=120s
  helm install clickhouse-operator oci://ghcr.io/clickhouse/clickhouse-operator-helm --version 0.0.5 \
    --namespace clickhouse-operator --create-namespace
  kubectl wait --for=condition=Established \
    crd/clickhouseclusters.clickhouse.com crd/keeperclusters.clickhouse.com --timeout=120s
  ```

- Les droits de créer un ClusterRole et son ClusterRoleBinding, que pose le sous-chart SeaweedFS.

## Installation

1. Remplacer dans les deux fichiers de valeurs les noms `langfuse.example.com` et `otlp.example.com` et l'adresse `admin@example.com`. Fournir les Secrets TLS `langfuse-tls` et `qrg-otel-collector-tls`, ou les faire produire par cert-manager en ajoutant l'annotation de l'émetteur dans les `annotations` de chaque ingress.
2. Créer le namespace et les Secrets, dans un terminal ordinaire :

   ```sh
   kubectl create namespace langfuse
   sh deploy/observability/creer-secrets.sh langfuse
   ```

3. Installer Langfuse, puis le collecteur :

   ```sh
   helm install langfuse oci://ghcr.io/langfuse/langfuse-k8s/charts/langfuse --version 2.1.4 \
     -n langfuse -f deploy/observability/langfuse-values.yaml
   helm install qrg-otel-collector opentelemetry-collector \
     --repo https://open-telemetry.github.io/opentelemetry-helm-charts --version 0.175.1 \
     -n langfuse -f deploy/observability/collector-values.yaml
   ```

Au premier démarrage, Langfuse crée l'organisation `linagora`, le projet `qrg`, sa paire de clés et le compte administrateur. Les variables d'initialisation, mot de passe administrateur et clé secrète du projet compris, ne vont qu'au conteneur web, le seul qui les lit. L'inscription libre est fermée et les statistiques d'usage vers Langfuse sont coupées.

## Contrôles après installation

Dans un terminal ordinaire, hors de toute session Claude :

```sh
kubectl -n langfuse get pods
curl -s -o /dev/null -w '%{http_code}\n' https://langfuse.example.com/api/public/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"resourceSpans":[]}' https://otlp.example.com/v1/traces
T="$(kubectl -n langfuse get secret qrg-otel-collector -o jsonpath='{.data.otlp-token}' | base64 -d)"
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $T" -d '{"resourceSpans":[]}' https://otlp.example.com/v1/traces
unset T
```

Tous les pods doivent tourner, la santé de Langfuse répondre 200, l'envoi sans jeton 401 et l'envoi avec jeton 200. Le mot de passe administrateur se copie sans affichage, sur macOS, avec `kubectl -n langfuse get secret langfuse -o jsonpath='{.data.admin-password}' | base64 -d | pbcopy`.

## Jeton du poste

Le jeton se range dans le fichier d'identifiants de DSH, comme la clé de la gateway, sous la référence que fixera #9, toujours hors de toute session Claude. Il se copie sans affichage avec `kubectl -n langfuse get secret qrg-otel-collector -o jsonpath='{.data.otlp-token}' | base64 -d | pbcopy`. Pour le changer, remplacer la clé `otlp-token` du Secret puis relancer le collecteur avec `kubectl -n langfuse rollout restart deployment/qrg-otel-collector`.

## Vérifier la configuration du collecteur

`verifier-collecteur.py` rend le chart du collecteur avec `collector-values.yaml`, valide la configuration obtenue, puis lance le collecteur sur la machine locale. Il lui envoie des traces factices chargées de contenu marqué et contrôle l'authentification, chaque filtre et les en-têtes de l'export vers un faux Langfuse. Il demande Python 3, Helm et le binaire `otelcol-contrib` de la version de l'image :

```sh
V=0.161.0 A=darwin_arm64   # ou linux_amd64
U=https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$V
curl -sSfLO "$U/otelcol-contrib_${V}_$A.tar.gz" -O "$U/otelcol-contrib_${V}_$A.tar.gz.sha256"
echo "$(cat otelcol-contrib_${V}_$A.tar.gz.sha256)  otelcol-contrib_${V}_$A.tar.gz" | shasum -a 256 -c
tar xzf "otelcol-contrib_${V}_$A.tar.gz" otelcol-contrib
python3 deploy/observability/verifier-collecteur.py --otelcol ./otelcol-contrib
```

À relancer après toute modification de `collector-values.yaml`, notamment de la liste autorisée.

## Points ouverts

- Cluster, exploitant et noms DNS, puis adresse OTLP à noter dans `notes/acces-lot1.md`.
- Exposition de l'interface Langfuse : l'ingress la publie avec l'API publique ; la restreindre au réseau LINAGORA si l'infrastructure le permet.
- Trafic interne en clair entre le collecteur et Langfuse ; une NetworkPolicy peut le limiter au seul collecteur.
- Stockage objet : SeaweedFS embarqué ou S3 externe ; sauvegardes de Postgres et de ClickHouse ; durée de conservation des traces.
- Connexion par SSO plutôt que par le compte administrateur.
- Double comptage des tokens à vérifier sur une trace réelle (#25).
