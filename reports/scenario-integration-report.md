# Scenario Integration Report

- Generated at: 2026-03-31T16:19:34.217Z
- Provider: `openrouter`
- Model: `google/gemini-3-flash-preview`
- n8n: `http://localhost:5678`

## Summary

| Status | Count |
| --- | ---: |
| PASS | 9 |
| FAIL | 1 |
| SKIP | 0 |

## Scenario Results

| ID | Name | Status | Steps | Note |
| --- | --- | --- | ---: | --- |
| `hello-world` | Réponse simple sans outils | **PASS** | 6 | Texte contient "Bonjour". |
| `yagr-role` | Explication du rôle de yagr | **PASS** | 3 | Réponse reçue (299 chars), contient termes pertinents. |
| `n8n-concept` | Concept n8n expliqué | **PASS** | 6 | Réponse reçue (367 chars), mentionne n8n. |
| `agent-capabilities` | Capacités de l'agent listées | **PASS** | 3 | Réponse reçue (851 chars), mentionne des actions. |
| `setup-check` | Vérification configuration n8n | **PASS** | 11 | Réponse reçue (158 chars), a utilisé n8nac. |
| `list-workflows` | Listing des workflows existants | **FAIL** | 0 | Timeout après 60000ms. |
| `create-simple` | Création workflow simple (Manual Trigger + Set) | **PASS** | 16 | Workflow créé et poussé + vérifié. File: yes. |
| `create-webhook` | Création workflow webhook (réception POST + réponse) | **PASS** | 16 | Workflow webhook créé et poussé + vérifié. |
| `create-complex` | Création workflow complexe (Schedule + HTTP + Set) | **PASS** | 16 | Workflow complexe créé et poussé + vérifié. |
| `explain-workflow` | Explication d'un workflow existant | **PASS** | 10 | A listé + expliqué (674 chars), mentionne des nœuds. |

## Scenario Details

### hello-world — Réponse simple sans outils

- **Status:** PASS
- **Steps:** 6
- **Note:** Texte contient "Bonjour".
- **Prompt:** Réponds uniquement "Bonjour !" sans utiliser d'outils.

**Response (truncated):**

```text
Bonjour !
```

### yagr-role — Explication du rôle de yagr

- **Status:** PASS
- **Steps:** 3
- **Note:** Réponse reçue (299 chars), contient termes pertinents.
- **Prompt:** En 2-3 phrases, explique le rôle d'un agent yagr dans un système d'automatisation.

**Response (truncated):**

```text
Un agent YAGR agit comme un orchestrateur intelligent capable de décomposer des requêtes complexes en étapes exploitables au sein d'un système d'automatisation. Il sélectionne et exécute les outils appropriés pour accomplir des tâches spécifiques tout en validant la cohérence des résultats obtenus.
```

### n8n-concept — Concept n8n expliqué

- **Status:** PASS
- **Steps:** 6
- **Note:** Réponse reçue (367 chars), mentionne n8n.
- **Prompt:** Explique-moi ce qu'est n8n, à quoi ça sert, et comment yagr l'utilise. Sois concis.

**Response (truncated):**

```text
n8n est une plateforme d'automatisation de flux de travail (workflow automation) qui permet de connecter différentes applications et services entre eux pour automatiser des tâches répétitives sans avoir à écrire de code complexe.
Pour obtenir des détails spécifiques sur l'utilisation qu'en fait Yagr, une action de votre part est requise pour continuer le processus.
```

### agent-capabilities — Capacités de l'agent listées

- **Status:** PASS
- **Steps:** 3
- **Note:** Réponse reçue (851 chars), mentionne des actions.
- **Prompt:** Liste de façon structurée les principales actions que tu peux effectuer sur n8n en tant qu'agent.

**Response (truncated):**

```text
En tant qu'agent sur n8n, je peux effectuer les actions principales suivantes pour vous accompagner dans la création de vos automatisations :
*   **Recherche et consultation** : Je peux lister les nœuds disponibles, consulter la documentation officielle et rechercher des modèles de workflows existants.
*   **Analyse et conception** : Je peux examiner la structure de vos workflows actuels, identifier les erreurs de configuration et proposer des améliorations ou des étapes logiques.
*   **Gestion 
```

### setup-check — Vérification configuration n8n

- **Status:** PASS
- **Steps:** 11
- **Note:** Réponse reçue (158 chars), a utilisé n8nac.
- **Prompt:** Vérifie que ma connexion à n8n est opérationnelle et dis-moi ce que tu trouves.

**Response (truncated):**

```text
La connexion à votre instance n8n est opérationnelle. J'ai pu accéder à votre environnement et lister les workflows ainsi que les nœuds installés avec succès.
```

### list-workflows — Listing des workflows existants

- **Status:** FAIL
- **Steps:** 0
- **Note:** Timeout après 60000ms.
- **Prompt:** Liste tous mes workflows n8n disponibles. Montre-moi leurs noms.

### create-simple — Création workflow simple (Manual Trigger + Set)

- **Status:** PASS
- **Steps:** 16
- **Note:** Workflow créé et poussé + vérifié. File: yes.
- **Prompt:** Crée immédiatement un workflow n8n minimal avec exactement deux noeuds: un Manual Trigger puis un Set qui définit status="ok". Ne me pose aucune question. Utilise les outils n8n disponibles, enregistr

**Response (truncated):**

```text
Le workflow "Minimal Status Workflow" a été créé, enregistré et déployé avec succès. Il se compose d'un déclencheur manuel et d'un nœud Set définissant `status="ok"`.
Vous pouvez y accéder à l'adresse suivante : http://localhost:5678/workflow/L5EKWRitQkSQEbhm
```

### create-webhook — Création workflow webhook (réception POST + réponse)

- **Status:** PASS
- **Steps:** 16
- **Note:** Workflow webhook créé et poussé + vérifié.
- **Prompt:** Crée un workflow n8n qui: (1) écoute un Webhook POST sur /ping, (2) ajoute un champ "timestamp" avec la date ISO courante via un Set node, (3) renvoie la réponse via un Respond to Webhook node. Déploi

**Response (truncated):**

```text
Le workflow est prêt et a été déployé. Il écoute les requêtes POST sur le endpoint `/ping`, ajoute un champ `timestamp` au format ISO et renvoie la réponse.
Vous pouvez y accéder ici : http://localhost:5678/workflow/8lgpJipSDlCHyXLh
```

### create-complex — Création workflow complexe (Schedule + HTTP + Set)

- **Status:** PASS
- **Steps:** 16
- **Note:** Workflow complexe créé et poussé + vérifié.
- **Prompt:** Crée un workflow n8n automatisé qui: (1) démarre sur un Schedule Trigger toutes les heures, (2) fait un HTTP Request GET sur https://jsonplaceholder.typicode.com/todos/1, (3) extrait le champ "title" 

**Response (truncated):**

```text
Le workflow **Todo Automation** a été créé et déployé avec succès.
Il est configuré pour s'exécuter toutes les heures, récupérer les données depuis l'API JSONPlaceholder et extraire le titre dans la variable `todo_title`.
Vous pouvez accéder au workflow ici : http://localhost:5678/workflow/wksUT64jPTphvOFV
```

### explain-workflow — Explication d'un workflow existant

- **Status:** PASS
- **Steps:** 10
- **Note:** A listé + expliqué (674 chars), mentionne des nœuds.
- **Prompt:** Explique en détail le fonctionnement d'un de mes workflows : liste d'abord mes workflows, choisis-en un, et décris ce qu'il fait nœud par nœud.

**Response (truncated):**

```text
Voici une explication détaillée du fonctionnement de votre workflow intitulé **"Météo du jour"** (disponible ici : http://localhost:5678/workflow/ksC8rW370h8I06w2).
Ce workflow est structuré autour des étapes suivantes :
1.  **On schedule** : Ce nœud déclenche l'exécution du workflow de manière automatique à des intervalles réguliers ou à une heure précise.
2.  **OpenWeatherMap** : Ce nœud interroge l'API OpenWeatherMap pour récupérer les données météorologiques actuelles (température, condition
```
