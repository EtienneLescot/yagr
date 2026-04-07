# Thinking Tokens — Analyse architecturale et décision

## Contexte

Les modèles de raisonnement actuels (Claude 3.7+, Gemini 3 Flash Preview, DeepSeek R1, o3...)
exposent leurs chaînes de pensée internes via un canal séparé du texte de réponse.
L'objectif Yagr est d'afficher ces tokens dans les **operation cards** (`category: 'thinking'`).

---

## 1. Pourquoi les tokens de thinking n'apparaissent pas dans le deepagent ?

### Root cause identifiée après investigation

Le problème n'est **pas** dans la couche tooling (LangChain / DeepAgents) — il est dans la
combinaison **provider × prompt length × nombre d'outils** pour le provider `copilot-proxy`.

Tests effectués avec `gemini-3-flash-preview` via Copilot proxy :

| Condition | reasoning_text présent ? |
|-----------|--------------------------|
| model.stream() direct | ✅ oui |
| model.streamEvents() direct | ✅ oui |
| model.bindTools([1 outil]).streamEvents() | ✅ oui |
| model.bindTools([16 outils]) + streamEvents() | ✅ oui (thinking_budget injecté) |
| deepagent.streamEvents() + system prompt réel (37 Kchars) + 16 outils | ❌ non |

→ La **longueur du system prompt** (~37 K caractères) combinée avec 16 outils dépasse la
capacité ou la configuration interne du proxy Copilot pour Gemini. Le
modèle supprime silencieusement le reasoning. Ce n'est pas un bug LangChain/DeepAgents —
c'est une limite de capacité du provider dans ce contexte.

---

## 2. Évaluation de LiteLLM

LiteLLM (github.com/BerriAI/litellm) est une solution sérieuse et bien maintenue (42K ⭐,
100+ providers, support natif de `reasoning_content` cross-provider).

### Ce que LiteLLM fait bien

- Normalise `reasoning_content` dans un format unifié pour Anthropic, DeepSeek, Gemini,
  OpenRouter, Groq, XAI, Perplexity, Mistral (models magistral), Bedrock…
- Supporte `litellm.supports_reasoning(model)` pour détecter si un modèle pense
- Gère les edge cases complexes (thinking_blocks à renvoyer entre turns pour Anthropic +
  tool calling)
- Intégration LangChain via `ChatLiteLLM` (Python `langchain_community`)

### Pourquoi LiteLLM n'est pas la bonne réponse pour Yagr

| Critère | LiteLLM |
|---------|---------|
| Langage | **Python uniquement** — le SDK est un package pip. Pas de SDK JS/TS officiel. |
| `ChatLiteLLM` pour LangChain | Python uniquement (`langchain_community`, pas `@langchain/community`) |
| LiteLLM Proxy (gateway HTTP) | Dépendance Python sidecar — `pip install litellm`, `litellm --config` à côté du process Node. Inacceptable pour un outil CLI installé localement par l'utilisateur. |
| Résout le copilot-proxy issue ? | **Non** — le problème est la capacité du proxy Copilot face à un long system prompt + tools. LiteLLM ne peut pas contourner une limite upstream du provider. |

**Conclusion : LiteLLM n'est pas applicable dans la stack TypeScript / Node.js de Yagr.**

---

## 3. Ce que LangChain + DeepAgents supportent nativement

La bonne nouvelle : **la stack est déjà correcte**. LangChain gère nativement
les thinking tokens pour tous les providers majeurs :

| Provider | Connecteur LangChain | Canal thinking |
|----------|----------------------|----------------|
| Anthropic (direct) | `@langchain/anthropic` `ChatAnthropic` | `content[].type === 'thinking'` |
| Gemini (direct) | `@langchain/google-genai` `ChatGoogleGenerativeAI` | `content[].type === 'thinking'` ou `additional_kwargs.reasoning_content` |
| OpenAI o1/o3 | `@langchain/openai` `ChatOpenAI` | `delta.reasoning_content` (Responses API) |
| DeepSeek | `@langchain/openai` `ChatOpenAI` | `delta.reasoning_content` |
| OpenRouter | `@langchain/openai` `ChatOpenAI` | `delta.reasoning_content` |
| copilot-proxy (Gemini) | `@langchain/openai` + `CopilotCompletionsModel` | `delta.reasoning_text` → `additional_kwargs.reasoning_content` |

DeepAgents transmet tous ces chunks via `on_chat_model_stream` → `extractDeltas()` dans
`langgraph-events.ts` lit déjà tous ces formats.

---

## 4. Décision architecturale

### Ne pas faire
- ❌ Introduire LiteLLM (Python + sidecar process) dans la stack Yagr
- ❌ Créer une abstraction supplémentaire par-dessus LangChain (réinventer LiteLLM en TS)
- ❌ Supposer que `copilot-proxy + gemini + long system prompt` peut exposer du thinking
  de façon fiable

### Faire
- ✅ **Conserver la stack LangChain + DeepAgents** — c'est l'état de l'art JS pour les agents
- ✅ **Utiliser les connecteurs provider-natifs** quand disponibles — ils gèrent le thinking
  mieux qu'un proxy OpenAI-compat :
  - `ChatAnthropic` pour Anthropic direct : thinking natif, fiable, multi-turn
  - `ChatGoogleGenerativeAI` pour Gemini direct : thinking natif
  - `ChatOpenAI` pour OpenAI, DeepSeek, OpenRouter : `reasoning_content` dans delta
- ✅ **copilot-proxy** : garder le `CopilotCompletionsModel` + `thinking_budget` injecté
  en best-effort. Le thinking fonctionnera pour les prompts courts / petits workspaces.
  C'est une limitation du provider, pas de Yagr.
- ✅ **`extractDeltas()` dans `langgraph-events.ts`** reste le SSOT pour normaliser
  le thinking cross-provider — c'est le bon endroit, et il couvre déjà tous les formats.
- ✅ **Documenter la limite** dans la configuration : si l'utilisateur veut le thinking
  sur Gemini, lui recommander `google` (direct) plutôt que `copilot-proxy`.

---

## 5. Amélioration future envisageable

Si le besoin de normalisation cross-provider devient plus large (ex. passer de `copilot-proxy`
à `google` automatiquement selon les capacités), la bonne approche restera :

1. **Enrichir `extractDeltas()`** — déjà extensible, couvre tous les formats connus
2. **Utiliser `@langchain/google-genai`** pour les utilisateurs Gemini natifs (hors proxy)
3. **Surveiller `@langchain/community`** : la communauté LangChain JS tend à absorber les
   normalisations que LiteLLM fait en Python (ex. le standard `reasoning_content`)

---

## Résumé

> Le problème de thinking tokens chez Yagr n'est pas un problème de librairie manquante
> — c'est une limite de capacité du provider `copilot-proxy` sous un system prompt long.
> LangChain + DeepAgents est la stack correcte. LiteLLM ne serait applicable qu'en Python,
> et son usage comme proxy sidecar serait incompatible avec un outil CLI léger.
> L'architecture actuelle est saine : continuer sur cette voie.
