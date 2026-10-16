# Accès pour le lot 1

Cette note rassemble ce qu'il faut pour joindre l'AI Gateway LINAGORA et la cible des traces au lot 1. Elle ne contient aucun secret : les clés restent hors du dépôt et hors de toute session Claude. Les décisions correspondantes sont dans la section Décisions de `notes/SPEC.md` (16 octobre 2026).

## AI Gateway

La gateway est déclarée comme fournisseur compatible OpenAI (`notes/HANDOFF.md`). L'adresse et les noms de routes ne sont pas des secrets ; ils sont à compléter une fois la clé QRG créée.

| Élément | Valeur |
| --- | --- |
| Adresse de base | à compléter |
| Protocole | OpenAI Chat Completions (`api: openai-completions`) |
| Modèle de tête, hébergé par LINAGORA | à compléter |
| Qwen (juge local et agents natifs) | à compléter |
| Mistral | à compléter |
| DeepSeek hébergé par LINAGORA | à compléter |
| Référence de la clé | `LINAGORA_API_KEY` |

Le profil `qrg` ne porte que la référence de la clé, jamais sa valeur ; la structure suit `docs/user/guide/providers.md` de DSH :

```yaml
- id: llm-pi-ai
  config:
    providers:
      linagora:
        apiKeyEnv: LINAGORA_API_KEY
        api: openai-completions
        baseURL: <adresse de base>
        models:
          - id: <route>
```

## Clé de la gateway

La clé est dédiée à QRG : limitée aux routes du lot 1 si la gateway le permet, avec un plafond de dépense et une date d'expiration. DSH la lit par son service `credentials`, dans son fichier d'identifiants `$DSH_HOME/.credentials.yaml` (`~/.dsh` par défaut). Ce fichier suit le format `version: 1`, les clés étant rangées sous `refs:`, et DSH refuse de démarrer s'il est lisible par le groupe ou les autres. La référence `LINAGORA_API_KEY` est celle que la page Models de DSH dériverait d'un fournisseur d'identifiant `linagora` (`deriveKeyRef`, `packages/client/ui-settings-models/src/client/store.ts`).

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
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $K" <adresse de base>/models
   curl -s -H "Authorization: Bearer $K" <adresse de base>/models | jq -r '.data[].id'
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

La cible des traces est choisie et montée par le ticket #2 ; son adresse OTLP et le rangement de ses identifiants d'export seront notés ici.
