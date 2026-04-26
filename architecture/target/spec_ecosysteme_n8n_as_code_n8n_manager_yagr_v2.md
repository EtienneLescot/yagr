# Spécification d’architecture et de positionnement — version mise à jour

## Écosystème `n8n-as-code`, `n8n-manager`, `n8n-credentials-manager`, YAGR et intégrations agents

## État d’implémentation au 2026-04-26

La séparation n’est plus seulement documentaire :

- `/home/etienne/repos/n8n-manager` existe comme repo indépendant ;
- `@n8n-as-code/n8n-manager-core` porte les contrats de lifecycle runtime ;
- `@n8n-as-code/n8n-credentials-manager` porte les recettes, starter kits, inventaire, client REST n8n et CRUD/test credentials ;
- `/home/etienne/repos/n8n-as-code/packages/workflow-core` existe comme point d’ancrage du moteur workflow et des contrats de modes façade ;
- `/home/etienne/repos/n8n-as-code/packages/manager-adapter` existe comme pont optionnel des façades vers `n8n-manager` ;
- `n8nac` expose les modes communs via `setup` / `setup-modes` et la readiness/CRUD credentials via `credentials ...` ;
- l’extension VS Code/Cursor et le plugin OpenClaw consomment les mêmes contrats de modes façade.

Le reste à faire est l’extraction progressive du vieux core encore présent dans `packages/cli/src/core` vers `workflow-core`, et le branchement complet du lifecycle Docker/diagnostics historique de YAGR vers `n8n-manager`. Les opérations destructives doivent rester explicites et gardées (`--force`, confirmations UI, distinction suppression config vs suppression volumes/données).

Cette version intègre les derniers arbitrages :

- l’écosystème n8n doit vivre sous une ombrelle GitHub `n8n-as-code` ;
- YAGR doit rester indépendant, dans sa propre ombrelle ;
- le monorepo `n8n-as-code` ne doit pas être splitté artificiellement ;
- `n8n-manager` doit être séparé parce qu’il porte un cycle de vie infrastructurel distinct ;
- la feature “réutiliser le LLM configuré dans YAGR pour créer un credential n8n” doit être généralisée ;
- cette généralisation doit devenir une couche `n8n-credentials-manager` dans `n8n-manager` ;
- l’objectif n’est plus seulement de démarrer n8n, mais de fournir une instance n8n prête à exécuter de vrais workflows.
- `n8n-as-code` doit être distingué entre marque/façades utilisateur et moteur workflow indépendant ;
- les façades brandées `n8n-as-code` / `n8nac` importent les deux moteurs indépendants : `workflow-core` et `n8n-manager`.

---

# 1. Vision générale

L’écosystème doit être séparé en moteurs indépendants et façades composables :

```txt
n8n-as-code/n8n-as-code
→ marque produit et monorepo des façades n8n-as-code / n8nac
→ contient le moteur workflow indépendant et les façades utilisateur

n8n-as-code workflow-core
→ intelligence workflow n8n
→ représentation, génération, validation, schemas, templates, docs

n8n-as-code/n8n-manager
→ gestion d’infrastructure n8n
→ lifecycle instance, diagnostics, credentials readiness, starter kit

yagr/yagr
→ agent autonome agnostique
→ consommateur possible de n8n-as-code et n8n-manager
→ pas sous l’ombrelle n8n-as-code
```

L’objectif est d’éviter que YAGR porte toute la valeur n8n.  
La valeur principale autour de n8n doit être portée par :

```txt
n8n-as-code
n8n-manager
n8n-credentials-manager
```

YAGR reste un agent autonome, agnostique, capable de consommer ces briques, mais pas défini par elles.

Le point d’architecture central est :

```txt
workflow-core et n8n-manager sont deux moteurs indépendants.
Les façades n8n-as-code / n8nac orchestrent les deux.
```

Les façades incluent :

```txt
CLI n8nac
extension VS Code / Cursor
MCP server
plugins Claude Code / OpenClaw
intégration YAGR
apps futures
```

Elles portent l’expérience complète :

```txt
choisir entre connecter un n8n existant ou laisser n8n-manager créer/gérer l’instance
configurer ou importer les credentials
générer / valider le workflow
déployer / exécuter / inspecter le résultat
```

---

# 2. Structure GitHub recommandée

## 2.1 Repos principaux

Structure recommandée :

```txt
yagr/yagr

n8n-as-code/n8n-as-code
n8n-as-code/n8n-manager
```

Cette structure reflète les responsabilités réelles :

```txt
yagr/yagr
= agent autonome agnostique

n8n-as-code/n8n-as-code
= monorepo produit n8n-as-code
= façades brandées n8n-as-code / n8nac
= workflow-core indépendant

n8n-as-code/n8n-manager
= manager infrastructurel n8n autonome
```

## 2.2 Pourquoi ne pas mettre YAGR sous `n8n-as-code`

YAGR doit rester indépendant parce qu’il est devenu :

```txt
un agent autonome de développement
agnostique
extensible
capable d’utiliser plusieurs plugins ou substrates
```

YAGR peut consommer `n8n-as-code` et `n8n-manager`, mais il ne doit pas être structurellement ou symboliquement rattaché à l’écosystème n8n.

À éviter :

```txt
n8n-as-code/yagr
flowyard/yagr
yagr/n8n-as-code
```

La structure correcte est :

```txt
yagr/yagr
n8n-as-code/n8n-as-code
n8n-as-code/n8n-manager
```

## 2.3 Pourquoi l’ombrelle `n8n-as-code`

L’écosystème actuel est essentiellement centré sur n8n.  
Une marque abstraite comme `FlowYard` peut être pertinente plus tard si l’écosystème dépasse fortement n8n, mais elle est prématurée aujourd’hui.

Pour l’instant, l’ombrelle la plus claire est :

```txt
n8n-as-code
```

Elle permet d’avoir :

```txt
n8n-as-code/n8n-as-code
n8n-as-code/n8n-manager
```

Même si `n8n-as-code/n8n-as-code` est un peu redondant visuellement, c’est acceptable et courant pour une organisation GitHub qui porte le nom d’un écosystème.

## 2.4 Disclaimer de marque

Comme `n8n` est une marque et un produit existant, il faut ajouter un disclaimer dans les README :

```txt
n8n-as-code is an independent community project and is not affiliated with,
endorsed by, or sponsored by n8n.
```

Version française éventuelle :

```txt
n8n-as-code est un projet communautaire indépendant. Il n’est pas affilié,
approuvé ou sponsorisé par n8n.
```

---

# 3. Découpage stratégique

## 3.1 `n8n-as-code`

`n8n-as-code` désigne deux choses qu’il faut distinguer :

```txt
n8n-as-code comme marque / expérience utilisateur
n8n-as-code workflow-core comme moteur workflow indépendant
```

Le moteur `workflow-core` est la couche d’intelligence métier et technique autour de n8n.

Son rôle :

```txt
Représenter, générer, valider, documenter et manipuler des workflows n8n comme du code.
```

Il répond à la question :

```txt
Comment construire correctement un workflow n8n ?
```

Il ne doit pas être responsable de l’installation ou de la maintenance d’une instance n8n.

Il ne doit pas importer `n8n-manager`.

Les façades `n8n-as-code` peuvent importer `workflow-core` et `n8n-manager`.

Exemples :

```txt
n8nac generate / validate / search
→ workflow-core

n8nac setup / credentials / deploy / run
→ n8n-manager

extension VS Code / Cursor
→ workflow-core pour l’édition et la validation
→ n8n-manager pour setup, credentials, deploy, run, inspect
```

## 3.2 `n8n-manager`

`n8n-manager` est la couche infrastructurelle.

Son rôle :

```txt
Fournir, configurer, maintenir, observer, diagnostiquer et préparer
une instance n8n utilisable par un humain ou un agent.
```

Il répond à la question :

```txt
Comment disposer d’une instance n8n prête à exécuter de vrais workflows ?
```

Son périmètre inclut :

```txt
instance lifecycle
healthcheck
logs
diagnostics
workflow deployment
workflow execution
credentials readiness
credential starter kit
LLM proxy
OAuth/user-guided credential setup
```

## 3.3 `n8n-credentials-manager`

`n8n-credentials-manager` est une sous-couche de `n8n-manager`.

Son rôle :

```txt
Fournir à une instance n8n des credentials prêts à l’emploi,
testés et exploitables par les nodes n8n.
```

Il répond à la question :

```txt
Quels credentials sont disponibles pour que le premier workflow généré
ait des chances de tourner du premier coup ?
```

Il ne doit pas être limité au LLM.

Il doit gérer :

```txt
LLM proxy
OAuth Google
Notion
Slack
Supabase
Airtable
GitHub
HubSpot
Microsoft 365
Postgres
SMTP / IMAP
Telegram
HTTP generic credentials
Webhook auth
```

## 3.4 Façades n8n-as-code / n8nac

Les façades sont les orchestrateurs applicatifs.

Elles peuvent rester dans le monorepo `n8n-as-code/n8n-as-code` et conserver leur branding public :

```txt
n8nac
n8n-as-code extension
n8n-as-code MCP
n8n-as-code plugin Claude Code
n8n-as-code plugin OpenClaw
```

Mais leur statut architectural doit être explicite :

```txt
façade = couche UX / orchestration applicative
moteur workflow = workflow-core
moteur runtime = n8n-manager
```

Les façades doivent proposer une UX convergente :

```txt
How do you want to use n8n?

[Recommended] Create and manage a local n8n automatically
[Connect an existing n8n]
[Use generation-only mode]
```

Ensuite :

```txt
Configure starter credentials
Import existing credentials
Skip for now
```

Ce qui était historiquement porté surtout par YAGR doit devenir commun à toutes les façades :

```txt
setup instance
credentials readiness
LLM proxy credential
starter kits
deploy
run
inspect execution
iterate on failure
```

## 3.5 YAGR

YAGR doit être repositionné comme agent autonome agnostique.

Son rôle :

```txt
Comprendre une intention utilisateur,
planifier un projet,
choisir les outils/plugins disponibles,
générer du code,
orchestrer des actions,
valider un résultat.
```

YAGR peut utiliser :

```txt
n8n-as-code
n8n-manager
n8n-credentials-manager
autres plugins infrastructurels
outils CLI
MCP servers
APIs externes
repositories Git
```

Mais YAGR ne doit pas dépendre conceptuellement de n8n.

---

# 4. Pourquoi ne pas splitter le monorepo `n8n-as-code`

L’arbitrage retenu est :

```txt
Ne pas splitter le monorepo n8n-as-code tant qu’il est bien géré.
```

Donc on ne crée pas tout de suite :

```txt
n8n-as-code/cursor-extension
n8n-as-code/mcp-server
n8n-as-code/agent-pack
n8n-as-code/examples
n8n-as-code/docs
```

À la place, on garde :

```txt
n8n-as-code/n8n-as-code
```

comme monorepo principal.

## 4.1 Pourquoi garder CLI, extension, MCP, docs et exemples dans le monorepo

Ces éléments appartiennent naturellement au même produit :

```txt
core workflow model
schemas
node ontology
validation logic
template index
types
docs
config
agent context
release process
developer experience
```

Les splitter trop tôt créerait :

```txt
plus de CI à maintenir
plus de versioning croisé
plus de dépendances inter-repos
plus de coordination de releases
plus de duplication documentaire
plus de complexité pour contribuer
```

Tant que le monorepo est propre, c’est un avantage.

## 4.2 Structure interne recommandée pour `n8n-as-code`

```txt
n8n-as-code/
  packages/
    workflow-core/
    validator/
    schemas/
    templates/
    transformer/
    agent-context/
    manager-adapter/

  apps/
    cli/
    cursor-extension/
    vscode-extension/

  integrations/
    mcp-server/
    claude-code/
    openclaw/
    yagr/

  examples/
    workflows/
    prompts/
    projects/

  docs/
    setup.md
    cursor.md
    cli.md
    mcp.md
    agents.md
    n8n-manager.md

  README.md
  package.json
  pnpm-workspace.yaml
  turbo.json
```

## 4.3 Quand splitter plus tard

On ne splitte une brique que si elle coche au moins une de ces conditions :

```txt
elle peut vivre seule
elle a une audience différente
elle a un cycle de release différent
elle a des dépendances lourdes ou sensibles
elle peut être utilisée sans n8n-as-code
elle crée de la confusion dans le monorepo
```

`n8n-manager` coche ces cases.

La CLI, l’extension, le MCP, les exemples et la doc ne les cochent pas encore.

## 4.4 Règle d’import interne

La règle d’import cible est :

```txt
@n8n-as-code/workflow-core
  ✕ n’importe pas n8n-manager

@n8n-as-code/n8n-manager
  ✕ n’importe pas workflow-core

n8nac CLI
  ✓ importe workflow-core
  ✓ importe n8n-manager ou manager-adapter

VS Code / Cursor extension
  ✓ importe workflow-core
  ✓ importe n8n-manager ou manager-adapter

Claude/OpenClaw/YAGR/MCP
  ✓ importent workflow-core
  ✓ importent n8n-manager si runtime nécessaire
```

Le branding utilisateur peut rester unifié sous `n8n-as-code`, mais les responsabilités techniques doivent rester séparées.

---

# 5. Pourquoi `n8n-manager` mérite un repo séparé

`n8n-manager` est différent de l’extension ou de la CLI, parce qu’il porte un cycle de vie infrastructurel autonome.

Il doit gérer :

```txt
installation n8n
démarrage / arrêt / redémarrage
Docker
ports
volumes
healthchecks
logs
diagnostics
workflow deployment
workflow execution
credential provisioning
secrets
OAuth flows
reset / destroy
```

Il touche à des sujets plus sensibles :

```txt
filesystem
Docker
credentials
volumes persistants
sécurité locale
environnement OS
actions destructives
```

Et surtout, il peut être utilisé par d’autres outils :

```txt
n8n-as-code CLI
extension Cursor / VS Code
Claude Code
OpenClaw
YAGR
MCP
scripts internes
agents autonomes
```

Donc il mérite un repo séparé :

```txt
n8n-as-code/n8n-manager
```

---

# 6. `n8n-credentials-manager`

## 6.1 Concept

Le point clé est que `n8n-manager` ne doit pas seulement fournir une instance n8n qui démarre.

Il doit fournir une instance n8n :

```txt
connectée
préparée
testée
capable d’exécuter des workflows utiles
```

C’est le rôle de `n8n-credentials-manager`.

Phrase produit :

```txt
n8n-manager does not just start n8n.
It prepares n8n to run useful workflows.
```

Version française :

```txt
n8n-manager ne se contente pas de démarrer n8n.
Il prépare n8n à exécuter de vrais workflows.
```

## 6.2 Responsabilité exacte

`n8n-credentials-manager` doit :

```txt
créer des credentials n8n
guider l’utilisateur pour les credentials OAuth
tester les credentials
inventorier les credentials disponibles
exposer l’inventaire à n8n-as-code
fournir des recipes de setup
fournir un starter kit de credentials
```

Il doit gérer différents types de sources :

```txt
API key
Personal Access Token
OAuth2
Basic Auth
Header Auth
Bearer Token
Database credentials
LLM proxy
Webhook auth
```

## 6.3 Pourquoi ce n’est pas seulement une feature LLM

La feature actuelle :

```txt
YAGR LLM configuré
→ proxy LLM
→ credential n8n
```

est un cas particulier d’un problème plus général :

```txt
Comment rendre une instance n8n prête à utiliser des services externes ?
```

Le LLM proxy devient seulement une recipe du starter kit.

---

# 7. Starter kit de credentials

## 7.1 Objectif

À la fin du wizard `n8n-manager`, l’utilisateur devrait voir quelque chose comme :

```txt
n8n is ready.

Available credentials:
✓ LLM proxy
✓ Google Drive / Sheets / Gmail
✓ Slack
✓ Notion
✓ Supabase
✓ HTTP generic credential

Your first workflows can now run.
```

Même si tous les credentials ne sont pas configurés, le système doit savoir afficher leur état :

```txt
ready
missing
partially configured
requires OAuth
requires API key
requires external setup
requires admin approval
test failed
```

## 7.2 Credential recipes

Une `CredentialRecipe` définit :

```txt
service
credential type n8n
méthode d’authentification
champs nécessaires
scopes recommandés
flow utilisateur
test de validation
nodes compatibles
niveau de friction
niveau de risque
```

Interface indicative :

```ts
type CredentialRecipe = {
  id: string
  service: string
  credentialTypeName: string
  authMethod: "api-key" | "oauth2" | "pat" | "basic" | "header" | "llm-proxy"
  requiredInputs: CredentialInput[]
  supportedNodes: string[]
  validation: ValidationProbe
  setupFlow: SetupFlow
  riskLevel: "low" | "medium" | "high"
}
```

## 7.3 Interface du credentials manager

```ts
interface N8nCredentialsManager {
  listRecipes(): Promise<CredentialRecipe[]>
  getCredentialInventory(): Promise<CredentialInventory>
  ensureCredential(recipeId: string, input: CredentialInput): Promise<N8nCredentialRef>
  testCredential(credentialId: string): Promise<CredentialTestResult>
  bootstrapStarterKit(starterKitId: string): Promise<StarterKitResult>
}
```

Le point central :

```txt
Le credential n’est pas seulement stocké.
Il est testé, typé, associé à des nodes, et exposé à n8n-as-code.
```

---

# 8. Credentials minimaux à supporter

## 8.1 Niveau 0 — indispensables

### 1. LLM credential via proxy

Rôle :

```txt
Permettre aux workflows IA de tourner sans que l’utilisateur configure
manuellement OpenAI, Anthropic, OpenRouter ou Ollama dans n8n.
```

Modes possibles :

```txt
OpenAI-compatible proxy
OpenAI direct
Anthropic direct
OpenRouter
Ollama local
Azure OpenAI
```

Le proxy est préférable par défaut quand c’est possible :

```txt
n8n → LLM proxy → provider réel
```

Avantages :

```txt
pas de vraie clé provider dans n8n
routing possible
révocation possible
logs/diagnostics possibles
modèle changeable sans modifier le workflow
```

### 2. HTTP Request credential générique

Indispensable pour tous les workflows qui appellent une API non couverte par un node dédié.

À supporter :

```txt
Basic Auth
Header Auth
Bearer Token
OAuth2 generic plus tard
```

### 3. Webhook auth starter

Très important pour sécuriser les workflows déclenchés depuis l’extérieur.

À générer :

```txt
Basic auth
Header auth
JWT auth plus tard
shared secret
```

## 8.2 Niveau 1 — productivity starter kit

### 4. Google OAuth bundle

À couvrir :

```txt
Google Drive
Google Sheets
Gmail
Google Calendar
Google Docs
```

Pour self-hosted, le manager doit guider l’utilisateur :

```txt
création projet Google Cloud
activation APIs
configuration écran de consentement
création OAuth client
configuration redirect URL n8n
validation scopes
test credential
```

### 5. Notion

Modes :

```txt
Internal integration token
OAuth2 public integration
```

À rappeler à l’utilisateur :

```txt
il faut partager les pages Notion avec l’intégration
```

### 6. Slack

Modes :

```txt
OAuth2 pour Slack node
API access token pour Slack Trigger
signature secret pour triggers
```

### 7. Supabase

Mode prioritaire :

```txt
API key
Project URL
Service role key ou anon key selon l’usage
```

Usage :

```txt
base de données
backend léger
storage
vector store
```

### 8. Airtable

Mode prioritaire :

```txt
Personal Access Token
```

OAuth2 possible plus tard.

## 8.3 Niveau 2 — business/dev starter kit

### 9. GitHub

Modes :

```txt
Personal Access Token
OAuth2
```

Usage :

```txt
issues
PRs
releases
repo automation
monitoring dev
```

### 10. HubSpot

Modes :

```txt
App token
OAuth2
```

Usage :

```txt
CRM
leads
contacts
deals
sales automation
```

### 11. Microsoft 365

À couvrir plus tard :

```txt
Outlook
OneDrive
Excel
SharePoint
Teams
To Do
```

En self-hosted, prévoir un flow guidé :

```txt
Azure app registration
client id
client secret
redirect URL
scopes
admin consent éventuel
```

### 12. Postgres

Champs :

```txt
host
port
database
username
password
SSL
SSH tunnel éventuellement
```

Usage :

```txt
data workflows
memory
PGVector
AI workflows
```

### 13. SMTP / IMAP

Usage :

```txt
envoi email
réception email
triggers email
```

Attention :

```txt
Microsoft / Outlook ne doit pas être traité comme simple IMAP basic auth.
Privilégier OAuth2 ou le node Microsoft Outlook quand nécessaire.
```

### 14. Telegram

Mode :

```txt
Bot token
```

Usage :

```txt
notifications
bot simple
triggers conversationnels
```

---

# 9. Wizard `n8n-manager`

## 9.1 Flow global

Après le setup instance :

```txt
Your n8n instance is ready.

Do you want to configure starter credentials?

[Recommended] Configure starter kit
[Skip for now]
[Import existing credentials]
```

Puis :

```txt
Choose your starter kit:

✓ AI workflows
  - LLM proxy
  - OpenAI-compatible credential
  - optional embeddings

✓ Productivity
  - Google Drive / Sheets / Gmail
  - Notion
  - Slack

✓ Data
  - Supabase
  - Airtable
  - Postgres

✓ Dev
  - GitHub
  - HTTP Request generic credentials

✓ Communication
  - Slack
  - Telegram
  - SMTP / IMAP
  - Microsoft Outlook
```

## 9.2 États affichés

Le wizard doit afficher des états simples :

```txt
Ready
Needs API key
Needs OAuth
Needs external setup
Needs admin approval
Failed test
Skipped
```

## 9.3 Expérience utilisateur minimale

Le setup ne doit pas commencer par demander :

```txt
OS
Docker mode
Port
Volumes
n8n version
Provider
Chemins système
```

Il doit commencer par :

```txt
Que voulez-vous faire ?
```

Puis proposer :

```txt
Create local n8n automatically
Connect existing n8n
Use generation-only mode
```

Ensuite seulement vient la phase credentials :

```txt
Configure starter credentials
Skip
Import
```

---

# 10. Interaction entre `n8n-credentials-manager` et `n8n-as-code`

`n8n-as-code` ne devrait pas générer un workflow dans le vide.

Il doit pouvoir recevoir un inventaire de credentials disponibles :

```json
{
  "availableCredentials": [
    {
      "service": "google",
      "nodes": ["Google Drive", "Google Sheets", "Gmail"],
      "credentialName": "Google Starter",
      "status": "ready"
    },
    {
      "service": "llm",
      "nodes": ["Chat OpenAI", "LM OpenAI"],
      "credentialName": "Local LLM Proxy",
      "status": "ready"
    },
    {
      "service": "slack",
      "nodes": ["Slack"],
      "credentialName": "Slack Workspace",
      "status": "ready"
    }
  ]
}
```

Ensuite, quand l’utilisateur demande :

```txt
Crée un workflow qui résume mes documents et envoie le résultat à l’équipe.
```

`n8n-as-code` peut naturellement choisir :

```txt
Google Drive → LLM Proxy → Slack
```

au lieu de générer un workflow théorique avec des credentials inexistants.

La boucle cible devient :

```txt
façade n8n-as-code / n8nac choisit le mode d’usage
n8n-manager prépare l’instance si nécessaire
n8n-credentials-manager prépare les credentials
workflow-core génère en fonction des credentials disponibles
n8n-manager déploie et exécute
```

---

# 11. Extraction de la feature YAGR LLM

## 11.1 État actuel

Aujourd’hui, une logique encore intriquée existe :

```txt
YAGR a un LLM configuré
YAGR expose/proxy ce LLM
YAGR crée un credential dans n8n pointant vers ce même LLM
```

Cette feature est cruciale pour réduire la friction, mais elle ne doit plus être spécifique à YAGR.

## 11.2 Abstraction cible

YAGR devient seulement une source possible de configuration LLM.

Le concept générique est :

```txt
LlmSource
```

Exemple :

```ts
interface LlmSource {
  id: string
  label: string
  getDescriptor(): Promise<LlmConnectionDescriptor>
  getSecret?(ref: SecretRef): Promise<string>
}
```

YAGR peut implémenter :

```ts
class YagrLlmSource implements LlmSource {
  id = "yagr-default-llm"
  label = "YAGR configured LLM"

  async getDescriptor() {
    return yagrConfig.getDefaultModel()
  }

  async getSecret(ref) {
    return yagrSecrets.get(ref)
  }
}
```

Puis YAGR appelle :

```ts
await n8nManager.credentials.ensureCredential("llm-proxy", {
  source: new YagrLlmSource(),
  credentialName: "YAGR LLM"
})
```

La dépendance va dans le bon sens :

```txt
YAGR peut dépendre de n8n-manager.
n8n-manager ne dépend jamais de YAGR.
```

## 11.3 Modes proxy et direct

Le credentials manager doit supporter deux modes.

### Mode direct

```txt
n8n → provider LLM réel
```

Avantages :

```txt
simple
moins de composants
pas de proxy à maintenir
```

Inconvénients :

```txt
la vraie clé est stockée dans n8n
moins de contrôle
moins portable
```

### Mode proxy

```txt
n8n → LLM proxy → provider réel
```

Avantages :

```txt
la vraie clé provider ne va pas dans n8n
routing possible
révocation possible
diagnostics possibles
compatibilité OpenAI-like
```

Inconvénients :

```txt
un composant de plus
réseau Docker à gérer
lifecycle à surveiller
```

Le mode proxy est recommandé par défaut lorsque c’est possible.

## 11.4 Ce que YAGR garde

YAGR garde :

```txt
sa configuration LLM
son système de secrets
son choix de modèle
sa logique agentique
sa décision d’utiliser n8n
son orchestration projet
```

YAGR ne garde plus :

```txt
le proxy n8n
la création de credential n8n
la logique réseau n8n
la compatibilité credential n8n
le lifecycle du bridge côté n8n
```

## 11.5 Où mettre l’adapter YAGR

Dans le repo YAGR :

```txt
yagr/yagr/
  packages/
    core/
    model-config/
    integrations/
      n8n/
        YagrLlmSource.ts
        setupN8nWithYagrLlm.ts
```

Ou :

```txt
yagr/yagr/
  packages/
    plugins/
      n8n/
```

Le core YAGR reste agnostique.

---

# 12. Sécurité

## 12.1 Règles générales

Le credentials manager doit :

```txt
ne jamais logger les secrets
ne jamais exposer publiquement le proxy par défaut
ne jamais supprimer de credential ou volume sans confirmation
ne pas créer de tunnel public sans consentement explicite
séparer token proxy et clé provider réelle
permettre la révocation des tokens proxy
tester les credentials sans fuite de données
```

## 12.2 LLM proxy

Le credential n8n devrait contenir :

```txt
baseUrl = http://llm-bridge:8080/v1
apiKey = proxy-local-token
```

et non :

```txt
OPENAI_API_KEY réelle
ANTHROPIC_API_KEY réelle
OPENROUTER_API_KEY réelle
```

Le proxy résout ensuite le vrai secret via la source LLM.

## 12.3 Docker et réseau

Si n8n tourne en Docker, il ne faut pas supposer que :

```txt
http://localhost:PORT
```

fonctionne depuis le conteneur n8n.

Modes possibles :

```txt
host.docker.internal
sidecar dans le même réseau Docker
service llm-bridge dans docker-compose
```

Le mode sidecar est préférable :

```txt
n8n → http://llm-bridge:8080/v1
```

---

# 13. Positionnement produit mis à jour

## 13.1 `n8n-as-code`

Phrase :

```txt
n8n-as-code gives AI coding agents deep n8n workflow intelligence.
```

Version française :

```txt
n8n-as-code donne aux agents de codage une compréhension profonde de n8n.
```

Promesse :

```txt
Construire des workflows n8n maintenables, validés, documentés et versionnables.
```

## 13.2 `n8n-manager`

Phrase :

```txt
n8n-manager provides a ready-to-run n8n environment for humans and AI agents.
```

Version française :

```txt
n8n-manager fournit un environnement n8n prêt à exécuter de vrais workflows.
```

Promesse :

```txt
Installer, configurer, démarrer, diagnostiquer et préparer une instance n8n
avec les credentials nécessaires pour que les workflows générés puissent tourner.
```

## 13.3 `n8n-credentials-manager`

Phrase :

```txt
n8n-credentials-manager prepares n8n credentials so generated workflows can run on the first try.
```

Version française :

```txt
n8n-credentials-manager prépare les credentials n8n pour que les workflows générés
aient des chances de tourner du premier coup.
```

## 13.4 YAGR

Phrase :

```txt
YAGR is an agnostic autonomous coding agent.
```

Version française :

```txt
YAGR est un agent autonome de développement, agnostique et extensible.
```

YAGR peut être un consommateur privilégié de l’écosystème, mais pas son centre.

---

# 14. Flux utilisateur mis à jour

## 14.1 Extension Cursor / VS Code

Premier lancement :

```txt
Welcome to n8n-as-code

How do you want to use n8n?

[Recommended] Create a local n8n automatically
[Connect existing n8n]
[Use generation-only mode]
```

Après création locale :

```txt
n8n is ready.

Do you want to configure starter credentials?

[Recommended] Configure starter kit
[Skip for now]
[Import existing credentials]
```

Puis :

```txt
Starter credentials configured:

✓ LLM Proxy
✓ Google Sheets
✓ Slack
✕ Notion — needs integration token
✕ Supabase — needs project URL and API key

[Create my first workflow]
[Open n8n]
```

## 14.2 CLI

Commandes principales :

```bash
n8n-manager setup
n8n-manager status
n8n-manager credentials list
n8n-manager credentials setup
n8n-manager credentials test
n8n-manager credentials starter-kit
n8n-manager llm-proxy status
```

Côté `n8n-as-code` :

```bash
n8n-as-code init
n8n-as-code setup
n8n-as-code generate "description du workflow"
n8n-as-code validate workflow.json
n8n-as-code deploy workflow.json
```

Le déploiement utilise l’inventaire de credentials si disponible.

## 14.3 YAGR

Demande utilisateur :

```txt
Crée une automation n8n qui utilise le même LLM que toi pour classifier des emails.
```

Flow cible :

```txt
1. YAGR analyse la demande.
2. YAGR décide que n8n est le bon substrate.
3. YAGR appelle n8n-manager.setup() si n8n n’est pas prêt.
4. YAGR fournit sa configuration LLM via YagrLlmSource.
5. n8n-manager / credentials-manager crée un credential LLM proxy.
6. workflow-core génère le workflow avec ce credential.
7. n8n-manager déploie le workflow.
8. n8n-manager exécute et inspecte le résultat.
9. YAGR itère si erreur.
```

---

# 15. Décisions finales actées

## 15.1 Structure des repos

Décision :

```txt
yagr/yagr
n8n-as-code/n8n-as-code
n8n-as-code/n8n-manager
```

## 15.2 YAGR

Décision :

```txt
YAGR reste indépendant et agnostique.
Il peut contenir une intégration optionnelle n8n.
Son core ne dépend pas de n8n.
```

## 15.3 Monorepo `n8n-as-code`

Décision :

```txt
Ne pas splitter CLI, extension, MCP, docs, exemples ou intégrations agents.
Tout reste dans le monorepo n8n-as-code tant que c’est cohérent.
```

## 15.4 `n8n-manager`

Décision :

```txt
n8n-manager sort comme repo séparé.
Il porte le lifecycle infrastructurel, les diagnostics,
la readiness d’exécution et la couche credentials.
```

## 15.5 `n8n-credentials-manager`

Décision :

```txt
Créer une couche n8n-credentials-manager dans n8n-manager.
Elle peut devenir un package public.
Elle ne devient un repo séparé que si elle acquiert un cycle de vie autonome.
```

## 15.6 Feature YAGR LLM

Décision :

```txt
La feature YAGR LLM → n8n credential est généralisée.
YAGR fournit une LlmSource.
n8n-credentials-manager transforme cette source en credential n8n.
n8n-manager ne dépend jamais de YAGR.
```

## 15.7 Starter kit

Décision :

```txt
Le wizard n8n-manager doit proposer un Credential Starter Kit.
Objectif : augmenter les chances que le premier workflow généré tourne du premier coup.
```

---

# 16. Résumé exécutif

L’écosystème cible est :

```txt
n8n-as-code/n8n-as-code
→ cerveau workflow n8n
→ génération, validation, templates, CLI, extension, MCP, intégrations

n8n-as-code/n8n-manager
→ environnement n8n prêt à exécuter
→ lifecycle, diagnostics, credentials manager, starter kit, LLM proxy

yagr/yagr
→ agent autonome agnostique
→ peut consommer n8n-as-code et n8n-manager
→ peut fournir sa config LLM comme source
```

Phrase centrale :

```txt
n8n-as-code sait construire des workflows.
n8n-manager sait fournir une instance n8n opérationnelle.
n8n-credentials-manager sait préparer les credentials nécessaires.
YAGR sait utiliser ces briques pour résoudre des tâches plus larges.
```

Le point stratégique le plus important :

```txt
La promesse de n8n-manager n’est pas “n8n démarre”.
La promesse est “n8n est prêt à exécuter des workflows utiles”.
```
