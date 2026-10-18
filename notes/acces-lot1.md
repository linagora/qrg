# Accès pour le lot 1

Cette note rassemble ce qu'il faut pour joindre l'AI Gateway LINAGORA et la cible des traces au lot 1. Elle ne contient aucun secret : les clés restent hors du dépôt et hors de toute session Claude. Les décisions correspondantes sont dans la section Décisions de `notes/SPEC.md` (16, 17 et 18 octobre 2026).

## AI Gateway

La gateway est déclarée comme fournisseur compatible OpenAI (`notes/HANDOFF.md`). L'adresse et les noms de routes ne sont pas des secrets ; ils ont été relevés le 18 octobre 2026 avec la clé QRG, par l'étape 4 ci-dessous.

| Élément | Valeur |
| --- | --- |
| Adresse de base | `https://ai-api.linagora.com/v1` |
| Protocole | OpenAI Chat Completions (`api: openai-completions`) |
| Modèle de tête, hébergé par LINAGORA | `qwen3.8` |
| Qwen (juge local et agents natifs) | `qwen3.8` |
| Mistral | absent de la gateway au 18 octobre 2026 |
| DeepSeek hébergé par LINAGORA | absent de la gateway au 18 octobre 2026 |
| Référence de la clé | `LINAGORA_API_KEY` |

Le 18 octobre 2026, la clé ouvrait aussi `nox-4b` et trois routes d'embedding (`bge-multilingual-gemma2`, `bge-m3`, `qwen3-embedding-8b`), sans rôle au lot 1 : la clé a été restreinte le même jour à `qwen3.8` (décision du 18 octobre 2026).

Le profil `qrg` ne porte que la référence de la clé, jamais sa valeur ; la structure suit `docs/user/guide/providers.md` de DSH :

```yaml
- id: llm-pi-ai
  config:
    providers:
      linagora:
        apiKeyEnv: LINAGORA_API_KEY
        api: openai-completions
        baseURL: https://ai-api.linagora.com/v1
        models:
          - id: qwen3.8
```

## Clé de la gateway

La clé est dédiée à QRG : limitée aux routes du lot 1, avec un plafond de dépense et une date d'expiration. DSH la lit par son service `credentials`, dans son fichier d'identifiants `$DSH_HOME/.credentials.yaml` (`~/.dsh` par défaut). Ce fichier suit le format `version: 1`, les clés étant rangées sous `refs:`, et DSH refuse de démarrer s'il est lisible par le groupe ou les autres. La référence `LINAGORA_API_KEY` est celle que la page Models de DSH dériverait d'un fournisseur d'identifiant `linagora` (`deriveKeyRef`, `packages/client/ui-settings-models/src/client/store.ts`).

### Étape guidée, hors de toute session Claude

Chaque commande se tape dans un terminal ordinaire, jamais avec `!` dans une session Claude, dont la sortie entre dans la transcription.

1. Quitter toutes les sessions Claude ouvertes : elles ont hérité de l'environnement du shell, ancienne clé comprise.
2. Sur la gateway, créer la clé QRG avec ses limites (routes du lot 1, plafond, expiration).
3. Ouvrir `~/.dsh/.credentials.yaml` dans un éditeur et ajouter sous `refs:` la ligne `LINAGORA_API_KEY: <clé>`, en gardant les entrées présentes. Un fichier vide ou absent devient :

   ```yaml
   version: 1
   refs:
     LINAGORA_API_KEY: <clé>
   ```

   Un fichier sans ligne `version: 1` est à l'ancien format à plat : ajouter `version: 1` et `refs:` en tête et indenter les entrées existantes de deux espaces, comme le demande DSH 0.2.1-alpha.4 au démarrage. Finir par `chmod 600 ~/.dsh/.credentials.yaml`.

4. Vérifier la clé sans l'afficher, puis lister les routes qu'elle ouvre :

   ```sh
   read -rs K
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $K" https://ai-api.linagora.com/v1/models
   curl -s -H "Authorization: Bearer $K" https://ai-api.linagora.com/v1/models | jq -r '.data[].id'
   unset K
   ```

   Le premier appel doit répondre 200. C'est le point d'entrée `GET /models` qu'interroge aussi la découverte de modèles de DSH.

5. Retirer l'export de l'ancienne variable du fichier d'init du shell, puis contrôler sans afficher de valeur : `grep -l LITELLM_API_KEY ~/.zshrc ~/.zshenv ~/.zprofile ~/.zlogin ~/.profile ~/.bash_profile ~/.bashrc 2>/dev/null` ne doit rien afficher, et `env | grep -c '^LITELLM_API_KEY='` doit répondre 0 dans un nouveau terminal. S'il répond 1, l'application de terminal garde l'ancien environnement : la quitter complètement et la rouvrir.
6. Donner aux autres outils du poste qui lisaient l'ancienne clé leur propre clé, puis révoquer l'ancienne sur la gateway.
7. Compléter le tableau de l'AI Gateway ci-dessus avec l'adresse et les routes.

### Protection sur le poste

Sur le poste de développement, aucune session Claude Code ne doit lire le fichier d'identifiants. Deux couches s'en chargent dans la configuration utilisateur de Claude Code :

- des règles `deny` sur `Read(~/.dsh/.credentials.yaml)` et `Edit(~/.dsh/.credentials.yaml)` ;
- un hook `PreToolUse` sur `Bash`, `Read` et `Grep` qui refuse toute commande nommant le fichier ou le dossier de DSH (hors sous-chemin simple comme `~/.dsh/profiles`), tout motif qui s'y étend, et toute recherche récursive sur ce dossier ou l'un de ses parents. Ce refus n'a pas de jeton de contournement.

Ces couches bloquent les accès directs. Un script qui construit le chemin à l'exécution reste un détour possible, de même que les outils qui pilotent le navigateur ou l'écran.

## Traces

Décisions des 16 et 17 octobre 2026 : Langfuse v4 auto-hébergé sur un cluster Kubernetes LINAGORA par son chart Helm officiel, derrière un collecteur OpenTelemetry LINAGORA monté sur le même cluster, et des traces réduites aux métadonnées. Le poste n'exporte qu'en OTLP/HTTP vers le collecteur, authentifié par un jeton d'écriture ; seul le collecteur détient la paire de clés du projet Langfuse. Il peut filtrer le contenu avant stockage et changer de cible sans toucher QRG.

| Élément | Valeur |
| --- | --- |
| Adresse OTLP du collecteur | à compléter |
| Jeton d'écriture du poste | à ranger dans le fichier d'identifiants de DSH, comme la clé de la gateway ; `qrg-otel` résout ses en-têtes d'export par le service `credentials` (#9) |
| Langfuse | v4 par le chart Helm officiel ; cluster, exploitant et nom DNS à fixer |

Les valeurs du chart et la configuration du collecteur, sans aucun secret, arrivent par une PR à part sous `deploy/observability/`.

### Langfuse

Faits relevés le 16 octobre 2026 dans la documentation de Langfuse, qui décrit la v4 :

- Langfuse reçoit les traces OTLP sur `/api/public/otel` (traces sur `/api/public/otel/v1/traces`), en HTTP/protobuf ou HTTP/JSON, pas en gRPC, avec une authentification Basic par la paire de clés du projet. L'auto-hébergé le permet depuis la v3.22.0 ; d'après le code de la v3.225.12, une v3 récente lit aussi le JSON et le gzip.
- Une instance comprend deux conteneurs (web et worker), Postgres, ClickHouse, Redis ou Valkey (version 7 au moins, avec `maxmemory-policy=noeviction`) et un stockage compatible S3. La v3 demande au moins Postgres 12 et ClickHouse 24.3, la v4 Postgres 15 et ClickHouse 25.12, à architecture égale.
- En production, Langfuse documente Kubernetes par son chart Helm et des modules Terraform pour AWS, Azure et GCP ; Docker Compose sert à l'usage local et aux tests, sans haute disponibilité ni sauvegarde.
- La v4 est sortie le 17 août 2026 ; la v3 reçoit des correctifs de sécurité jusqu'en janvier 2027. La v4 est retenue (décision du 17 octobre 2026).
- Le masquage côté serveur demande une licence Enterprise : le filtrage du contenu se fait donc dans le collecteur.

### Contenu des traces

Décision du 17 octobre 2026 : les traces ne portent que des métadonnées (décision, délégation, modèle, tokens, durée, issue), jamais de prompt, de complétion ni de contenu de fichier, de question ou d'outil. Deux barrières s'empilent. `qrg-otel` force la capture du contenu à faux (#9). Le collecteur abandonne ensuite tous les événements de span, ne garde que les attributs de span d'une liste autorisée et réduit les attributs de ressource à une liste fixe. La liste autorisée suivra les attributs que fixera #20 ; d'ici là, tout attribut qui n'y figure pas est supprimé.

### Collecteur

- Distribution contrib (ou k8s) d'OpenTelemetry Collector : c'est elle qui embarque l'extension `bearertokenauth` et les processeurs `transform` et `redaction`.
- Réception : récepteur `otlp` en HTTP, sous TLS, avec `auth.authenticator` sur `bearertokenauth`, qui sait aussi valider les requêtes entrantes (stabilité bêta).
- Filtrage : `filter` abandonne des spans entiers, `attributes` supprime ou hache des attributs, `transform` (OTTL) atteint aussi les événements de span, où des prompts peuvent se trouver, et `redaction` supprime tout attribut absent de sa liste autorisée, `langfuse.*` et `gen_ai.*` compris.
- Export vers Langfuse, d'après l'exemple de sa documentation, où `AUTH_STRING` vaut l'encodage base64 de `<clé publique>:<clé secrète>` et reste dans l'environnement du collecteur :

```yaml
exporters:
  otlp_http/langfuse:
    endpoint: https://<langfuse>/api/public/otel
    headers:
      Authorization: "Basic ${AUTH_STRING}"
      x-langfuse-ingestion-version: "4"
```

L'exportateur ajoute lui-même `/v1/traces`. Son ancien nom `otlphttp`, celui de la documentation de Langfuse, reste admis comme alias déprécié. Sans l'en-tête `x-langfuse-ingestion-version`, la documentation v4 annonce jusqu'à 10 minutes de délai d'ingestion ; son effet sur une v3 n'est pas documenté.

### Double comptage des tokens

D'après un mainteneur (langfuse/langfuse#7549), Langfuse additionne l'usage de toutes les générations d'une trace. Le ticket loongsuite/dsh-plugin#3, ouvert le 16 août 2026, signale que le span d'agent porte la somme de ses enfants LLM, ce qui double le total de la trace. Langfuse 3.206.0 ignore l'usage des spans dont `gen_ai.operation.name` vaut `invoke_agent` ou `agent_step` (langfuse/langfuse#14808). La base de `qrg-otel` ouvre son span d'agent par `startInvokeAgent` (`src/coordinator.ts:356` à `f44ccfc`), et `@loongsuite/otel-util-genai` 0.1.1 pose `invoke_agent` sur ce span à sa clôture. Hypothèse à vérifier sur une trace réelle dans un ticket de suite : sur une version récente de Langfuse, le total de la trace n'est plus doublé.
