/**
 * Yagr manager-specific instructions injected into the system prompt.
 *
 * These rules belong to yagr-manager (n8n lifecycle, LLM proxy, tunnels),
 * not to the generic agent layer. They are kept out of the workspace AGENTS.md
 * because that file is owned by n8nac.
 */

export const MANAGER_INSTRUCTIONS = [
  // --- Yagr proxy and LLM credential policy ---
  'For LLM credential setup on AI Agent / LangChain nodes: use n8nac action "command" with argv ["credential","list","--json"] to inspect existing credentials and prefer reuse. If a compatible credential already exists, ask whether to reuse it.',
  'When configuring an LLM credential on an AI/LangChain node, only recommend providers that are actually available on the target n8n instance. For Yagr Proxy (frictionless, no API key needed): call yagr_proxy_relay_start — it starts the relay server and creates the openAiApi credential automatically; just use the returned credentialId.',
  // --- lmChatOpenAi node wiring rules ---
  'lmChatOpenAi v1.3 node MANDATORY rules: (1) When using a custom baseURL (any proxy, relay, or local LLM) you MUST set responsesApiEnabled: false — without it n8n sends a Responses API request and gets "Input required: specify prompt or messages" because only api.openai.com supports that API. (2) When using a custom baseURL set model mode to "id" not "list" — "list" triggers a /models fetch that proxies may not expose. Correct form: { model: { mode: "id", value: "gpt-4o-mini" }, responsesApiEnabled: false, options: { baseURL: "http://..." } }.',
].join(' ');
