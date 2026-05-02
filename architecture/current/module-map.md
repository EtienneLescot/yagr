# Module Map

This page maps the repository at the package/system level.

## Workspace Packages

### Primary Public Bricks

- `@yagr/runtime`
- `@yagr/runtime-events`
- `@yagr/impact-ledger`
- `@yagr/reality-observer`
- `@yagr/plugin-runtime`
- `@yagr/provider-runtime`

These are the preferred package-level integration surfaces for downstream products such as a coding-agent VS Code extension.

### Optional Public Bricks

- `@yagr/session-service`
- `@yagr/conversation-service`
- `@yagr/stream-adapter`
- `@yagr/surfaces`

These are useful when an integrator wants to own part of the composition directly, such as session storage, slash-command behavior, stream normalization, or existing Yagr UI primitives.

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
- `@yagr/impact-ledger`
- `@yagr/reality-observer`
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

## Publish Policy

All packages required by the transitive npm graph are published publicly so consumers can install facades such as `@yagr/runtime` and `@yagr/surfaces` normally.

Publication does not mean every package is a recommended standalone API. Lower-level packages such as checkpoint, memory, bootstrap, registry, and individual surface packages are installable for npm resolution but are not promoted as primary integration bricks unless their APIs are explicitly stabilized.

The package manager SSOT is the pnpm workspace graph in `pnpm-workspace.yaml`. Source manifests use `workspace:*` for internal `@yagr/*` dependencies. `pnpm pack` and Changesets publishing rewrite those workspace ranges to concrete npm versions in package artifacts, so published manifests must not contain `file:`, `link:`, or `workspace:` dependencies.

Changesets is the release SSOT. Stable releases are prepared through a Changesets version PR on `main` and are published to npm `latest` only from stable semver source manifests. `next` publishes are CI-only Changesets snapshot releases under the npm `next` dist-tag; snapshot or prerelease versions are not committed to source manifests.

For a VS Code extension, prefer this composition path:

- import runtime construction from `@yagr/runtime`
- render progress and tool activity from `@yagr/runtime-events`
- record meaningful runtime effects with `@yagr/impact-ledger` and `@yagr/reality-observer`
- use `@yagr/plugin-runtime` for plugin contracts
- use `@yagr/session-service` only if the extension owns Yagr-compatible session UX directly

## Root App Composition

The root `src/` tree assembles the `@yagr/agent` app.

It wires:

- runtime packages
- surface packages
- provider setup
- sessions and conversation services
- gateway-level impact ledger wiring for streaming WebUI, TUI, and Telegram runs
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
