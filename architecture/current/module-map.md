# Module Map

This page maps the repository at the package/system level.

## Workspace Packages

### Facades

- `@yagr/runtime`
- `@yagr/surfaces`

These are the preferred integration surfaces for downstream products.

### Core Runtime Packages

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

### Surface Packages

- `@yagr/webui-surface`
- `@yagr/tui-surface`
- `@yagr/webui-session-registry`

### Plugin Packages

- `@yagr/plugin-runtime`

## Root App Composition

The root `src/` tree assembles the `@yagr/agent` app.

It wires:

- runtime packages
- surface packages
- provider setup
- sessions and conversation services
- CLI/WebUI/TUI/Telegram product entrypoints
- generic Agent Skills installation and source-path resolution

## Dependency Direction

Preferred direction:

- apps depend on facades
- facades depend on internal core/surface packages
- plugins depend on plugin/runtime contracts
- core does not depend on product-specific integration behavior

## Integrator Note

If integrating Yagr into another product, prefer `@yagr/runtime` and `@yagr/surfaces` over internal packages unless the facade is insufficient.
