# Module Map

This page maps the current repository at the package/system level.

## Workspace packages

### Facades

- `@yagr/runtime`
- `@yagr/surfaces`

These are the preferred integration surfaces for downstream products.

### Core runtime packages

- `@yagr/deepagent-bootstrap`
- `@yagr/provider-runtime`
- `@yagr/session-checkpoint`
- `@yagr/session-service`
- `@yagr/session-memory`
- `@yagr/runtime-events`
- `@yagr/stream-adapter`
- `@yagr/conversation-core`
- `@yagr/conversation-service`
- `@yagr/gateway-core`

### Surface packages

- `@yagr/webui-surface`
- `@yagr/tui-surface`
- `@yagr/webui-session-registry`

### Plugin packages

- `@yagr/plugin-runtime`
- `@yagr/plugin-n8n-manager`

`@yagr/plugin-n8n-manager` is now the optional Yagr-side adapter boundary for the external n8n-as-code ecosystem. It may expose Yagr-specific sources, such as `createYagrLlmSource(...)`, but it must not become the authority for generic n8n credential recipes, workflow intelligence, or infrastructure lifecycle.

## External n8n ecosystem

- `n8n-as-code workflow-core` in `/home/etienne/repos/n8n-as-code`
- `/home/etienne/repos/n8n-manager`
- `@n8n-as-code/n8n-manager-core`
- `@n8n-as-code/n8n-credentials-manager`
- `@n8n-as-code/n8n-manager`

`workflow-core` owns workflow intelligence. `n8n-manager` owns generic n8n infrastructure and credential-readiness contracts. Yagr consumes both through plugin/integration adapters instead of moving either responsibility into Yagr core.

The general rule for all facades is the same:

- the facade may import workflow intelligence and runtime readiness
- the workflow engine must not import the runtime manager
- the runtime manager must not import the workflow engine

## Root app composition

The root `src/` tree still contains the assembled `@yagr/agent` app composition.

Its job is increasingly to:

- wire the runtime packages together
- wire the surfaces together
- compose plugins where needed
- provide the current CLI/WebUI/TUI/Telegram product entrypoints

It should own less reusable runtime logic over time.

## Dependency direction

Preferred direction:

- apps depend on facades
- facades depend on internal core/surface packages
- plugins depend on plugin/runtime contracts
- Yagr n8n adapters may structurally match external `n8n-manager` contracts
- Yagr n8n adapters may consume external workflow-core contracts when workflow intelligence is needed
- core does not depend on manager-specific plugin behavior
- external `n8n-as-code workflow-core` never depends on `n8n-manager`
- external `n8n-manager` never depends on Yagr

## Important note for integrators

If you are integrating Yagr into another product, prefer:

- `@yagr/runtime`
- `@yagr/surfaces`

and avoid depending directly on many internal packages unless the facade is genuinely insufficient.
