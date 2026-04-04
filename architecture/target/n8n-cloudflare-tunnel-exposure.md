# Spec — Exposition des instances N8N via Tunnel Cloudflare

## Objectif

Permettre d'exposer n'importe quelle instance N8N (locale ou externe à Yagr, avec ou sans Docker) via un tunnel Cloudflare, de façon à ce que les triggers — notamment les webhooks — soient accessibles depuis l'extérieur (ex. façade Telegram, autres machines).

Le système doit être résilient : les URL de tunnel ne sont pas stables, il faut pouvoir les rafraîchir sans reconfigurer tout le système.

---

## Périmètre des configurations couvertes

| Configuration | Description |
|---|---|
| Yagr-Managed, sans Docker | n8n lancé en `direct` par Yagr, process local |
| Yagr-Managed, avec Docker | n8n lancé dans un conteneur Docker géré par Yagr |
| Non Yagr-Managed, sans Docker | n8n déjà en cours sur la machine, Yagr s'y connecte |
| Non Yagr-Managed, avec Docker | n8n dans un conteneur externe, Yagr s'y connecte via URL |

---

## Problème structurel actuel

Le tunnel Cloudflare est aujourd'hui utilisé uniquement pour le LLM Proxy (exposition de `localhost:11437` vers n8n). Il est spawné dans `application-services.ts#startCloudflareTunnel()` et stocké dans `YagrLlmProxyConfig.tunnelUrl`.

Ce tunnel couvre un seul sens : **Yagr → n8n** (n8n appelle le proxy Yagr via tunnel). Il ne couvre pas le sens **externe → n8n** (ex. Telegram ou autre machine appelle un webhook n8n).

Il faut un second tunnel orthogonal : **exposition de n8n vers l'extérieur**.

---

## Architecture cible

### Deux tunnels distincts

```text
[Tunnel A - existant] LLM Proxy
  cloudflared tunnel → localhost:11437 (relay Yagr)
  Utilisé par : n8n pour joindre le LLM Proxy Yagr

[Tunnel B - nouveau] N8N Webhook Exposure
  cloudflared tunnel → <n8n-host>:<n8n-port>
  Utilisé par : Telegram, machines externes, pour déclencher des webhooks n8n
```

Ces deux tunnels sont gérés indépendamment.

### Résolution de l'adresse n8n à tunneler

| Cas | Adresse n8n à tunneler |
|---|---|
| Managed direct | `localhost:<n8n-port>` (ex. `localhost:5678`) |
| Managed Docker | `localhost:<port-mappé-docker>` depuis l'hôte |
| Non-managed sans Docker | URL configurée par l'utilisateur (ex. `http://localhost:5678`) |
| Non-managed avec Docker | URL configurée par l'utilisateur |

Dans tous les cas, la cible du tunnel est **l'adresse depuis l'hôte Yagr** vers laquelle n8n répond.

---

## Composants à créer / modifier

### 1. `n8n-local/n8n-tunnel.ts` (nouveau)

Responsabilité unique : gérer le cycle de vie du tunnel d8n webhook.

```typescript
export interface N8nTunnelState {
  publicUrl: string;       // URL publique trycloudflare.com
  targetUrl: string;       // URL locale n8n tunnelée
  startedAt: Date;
  pid?: number;            // PID du process cloudflared
}

export interface N8nTunnelManager {
  start(targetUrl: string): Promise<N8nTunnelState>;
  stop(): Promise<void>;
  refresh(targetUrl: string): Promise<N8nTunnelState>; // stop + start
  getCurrent(): N8nTunnelState | null;
}
```

- Spawne `cloudflared tunnel --url <targetUrl>` avec les mêmes gardes que le tunnel LLM Proxy actuel.
- Stocke l'état dans `YAGR_HOME/n8n-tunnel.json` pour persistance inter-sessions.
- Émet des événements observables (start, stop, url-changed).

### 2. `config/yagr-config-service.ts` (modification)

Ajouter un champ `n8nTunnel` dans la config persistée :

```typescript
export interface N8nTunnelConfig {
  enabled: boolean;
  publicUrl?: string;      // Dernière URL connue, peut être périmée
  targetUrl: string;       // URL locale de n8n (recalculée si instancee managed)
}
```

### 3. `setup/application-services.ts` (modification)

Ajouter une méthode `setupN8nTunnel(n8nBaseUrl: string): Promise<N8nTunnelConfig>` qui :
- Détermine `targetUrl` selon la configuration d'instance (managed/externe, Docker/direct).
- Délègue le spawn à `N8nTunnelManager`.
- Persiste la config.

### 4. `tools/n8nac.ts` ou nouveau `tools/n8n-tunnel-tool.ts` (modification / nouveau)

Exposer des commandes LLM-invocables :

| Commande | Description |
|---|---|
| `n8n tunnel start` | Démarre le tunnel si pas actif |
| `n8n tunnel stop` | Arrête le tunnel |
| `n8n tunnel refresh` | Renouvelle l'URL (stop + start) |
| `n8n tunnel status` | Retourne l'URL publique actuelle et l'état |
| `n8n tunnel url` | Retourne uniquement l'URL publique (pour les workflows et le prompt) |

Ces commandes sont également disponibles en CLI (`yagr n8n tunnel ...`).

### 5. `gateway/workflow-links.ts` (modification)

`resolveWorkflowOpenLink` doit être capable de substituer l'URL de base n8n par l'URL tunnel publique quand le tunnel est actif, pour que les liens présentés à l'utilisateur (Telegram, TUI, WebUI) pointent vers la bonne adresse.

### 6. Prompt système (modification)

Injecter l'URL publique du tunnel n8n dans le prompt contextuel quand le tunnel est actif, pour que le LLM puisse l'utiliser dans ses réponses (ex. "le webhook est accessible à `https://xxx.trycloudflare.com/webhook/...`").

---

## Comportement de rafraîchissement des URL

Les URL `trycloudflare.com` changent à chaque restart du tunnel. Ce n'est pas stable. Le système doit :

1. **Détecter la péremption** : si le process `cloudflared` est mort, l'URL est périmée.
2. **Permettre le refresh manuel** via commande (`n8n tunnel refresh`).
3. **Optionnellement, refresh automatique** avec stratégie de backoff si le tunnel meurt inopinément.
4. **Propager le changement d'URL** aux surfaces concernées :
   - Prompt système (re-inject l'URL dans le contexte de la session)
   - Réponses aux commandes `tunnel url` / `tunnel status`
5. **Ne pas mettre à jour silencieusement** la config n8n elle-même pour `WEBHOOK_URL` : cela nécessite un redémarrage n8n avec la nouvelle variable. C'est un workflow explicite, pas automatique.

### Variable `N8N_WEBHOOK_URL` et redémarrage n8n

n8n a besoin de connaître son URL publique pour construire les URLs de webhooks. Cette variable doit être positionnée au démarrage.

Pour les instances **Yagr-Managed** :
- Au `start`, si le tunnel est actif, passer `N8N_WEBHOOK_URL=<publicUrl>` à n8n (via env Docker ou process).
- Au `refresh`, proposer un redémarrage n8n pour prendre en compte la nouvelle URL.

Pour les instances **non Yagr-Managed** :
- L'utilisateur est responsable de configurer `N8N_WEBHOOK_URL` manuellement.
- Yagr informe l'URL via `tunnel status` / `tunnel url`.

---

## Compatibilité avec les surfaces existantes

### Telegram Gateway

La façade Telegram est le déclencheur principal de la fonctionnalité. Elle peut envoyer des requêtes HTTP vers des webhooks n8n. Quand le tunnel est actif, l'URL publique remplace l'URL locale dans les références de workflow présentées à l'utilisateur Telegram.

### LLM Proxy Yagr

Le tunnel LLM Proxy (Tunnel A) reste inchangé. Les deux tunnels coexistent. Aucun couplage.

### Présentation des liens de workflow (`present-workflow-result.ts`)

Quand le tunnel n8n est actif, `resolveWorkflowOpenLink` substitue le host de l'URL n8n par l'URL tunnel publique, pour que le lien présenté soit cliquable depuis l'extérieur.

### Setup Wizard

Ajouter une étape optionnelle "Exposer N8N via tunnel" dans l'assistant de configuration, pour les cas où l'utilisateur veut un accès externe.

---

## Règles de conception

- Le tunnel n8n est un module distinct du tunnel LLM Proxy. Pas de couplage.
- L'état du tunnel est persisté dans `YAGR_HOME`, pas en mémoire uniquement.
- Les URL tunnels ne sont jamais considérées comme stables. Toute logique qui en dépend doit être capable de les recharger.
- La modification de `N8N_WEBHOOK_URL` sur une instance managed est explicite (commande `refresh` + redémarrage proposé), jamais silencieuse.
- Les instances non-managed ne sont pas modifiées par Yagr. Yagr expose, informe, mais ne reconfigure pas.
- Le module `n8n-tunnel.ts` est testable en isolation avec un mock de `cloudflared`.

---

## Stratégie de test

| Niveau | Contenu |
|---|---|
| Unit | `N8nTunnelManager` avec mock cloudflared (spawn simulé, URL émise) |
| Unit | Résolution de `targetUrl` selon les 4 configurations d'instance |
| Unit | `resolveWorkflowOpenLink` avec substitution tunnel active / inactive |
| Integration | Tunnel réel spawné sur Linux CI, URL obtenue, webhook atteignable |
| Manual | Validation Telegram → webhook n8n via tunnel |

---

## Diagramme de flux

```mermaid
flowchart TD
    User[Utilisateur / Telegram]
    Yagr[Yagr Agent]
    TunnelMgr[N8nTunnelManager]
    CF[cloudflared process]
    N8N[Instance N8N]

    User -->|n8n tunnel start| Yagr
    Yagr --> TunnelMgr
    TunnelMgr -->|spawn| CF
    CF -->|URL trycloudflare.com| TunnelMgr
    TunnelMgr -->|persiste N8nTunnelConfig| YAGR_HOME[(YAGR_HOME)]
    TunnelMgr -->|injecte URL dans contexte session| Yagr

    User -->|appel webhook externe| CF
    CF -->|proxy| N8N
    N8N -->|réponse| CF
    CF -->|réponse| User

    Yagr -->|n8n tunnel refresh| TunnelMgr
    TunnelMgr -->|stop + re-spawn| CF
    TunnelMgr -->|nouvelle URL| Yagr
    Yagr -->|propose redémarrage n8n si managed| N8N
```
