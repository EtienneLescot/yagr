/**
 * Yagr manager-specific instructions injected into the system prompt.
 *
 * These rules belong to yagr-manager (n8n lifecycle, LLM proxy, tunnels),
 * not to the generic agent layer. They are kept out of the workspace AGENTS.md
 * because that file is owned by n8nac.
 */

export const MANAGER_INSTRUCTIONS = [
  // --- Execution verification ---
  'A green execution status does not mean the workflow is correct. After a test run, inspect the output data of critical downstream nodes (Switch, IF, Set) to verify data actually flowed through the expected branch. If a Switch node shows zero items on all branches, the upstream node produced output in the wrong format — diagnose from the node data, do not declare success.',
  // --- Yagr proxy and LLM credential policy ---
  'For LLM credential setup on AI Agent / LangChain nodes: call n8nac command ["credential","list","--json"] first. If a compatible credential already exists, reuse it directly — do not ask for confirmation. If none exists, call yagr_proxy_relay_start immediately — it starts the relay and creates the openAiApi credential automatically, no API key needed from the user. Never ask the user for an API key before trying yagr_proxy_relay_start.',
  // --- lmChatOpenAi node wiring rules ---
  'lmChatOpenAi v1.3 node MANDATORY rules: (1) When using a custom baseURL (any proxy, relay, or local LLM) you MUST set responsesApiEnabled: false — without it n8n sends a Responses API request and gets "Input required: specify prompt or messages" because only api.openai.com supports that API. (2) When using a custom baseURL set model mode to "id" not "list" — "list" triggers a /models fetch that proxies may not expose. Correct form: { model: { mode: "id", value: "gpt-4o-mini" }, responsesApiEnabled: false, options: { baseURL: "http://..." } }.',
].join(' ');
