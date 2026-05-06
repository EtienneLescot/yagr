# Module Map

This page maps the repository at the package/system level.

## Workspace Packages

### Primary Public Bricks

- `@yagr/deepagent-bootstrap`
- `@yagr/provider-runtime`
- `@yagr/session-service`
- `@yagr/stream-adapter`
- `@yagr/runtime-events`
- `@yagr/impact-ledger`
- `@yagr/reality-observer`
- `@yagr/plugin-runtime`

These are the preferred package-level integration surfaces for downstream products such as a coding-agent VS Code extension. Compose only the runtime capabilities you need so consumers keep control over dependency closure and packaging footprint.

### Optional Public Bricks

- `@yagr/session-service`
- `@yagr/conversation-service`
- `@yagr/stream-adapter`
- `@yagr/surfaces`

These are useful when an integrator wants to own part of the composition directly, such as session storage, slash-command behavior, stream normalization, or existing Yagr UI primitives.

### Optional Facades

- `@yagr/runtime`
- `@yagr/surfaces`

These are convenience re-export packages. They remain useful for quick starts, but they are not the architectural source of truth for downstream integrations.

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

All packages required by the transitive npm graph are published publicly so consumers can install granular runtime bricks or optional facades normally.

Publication does not mean every package is a recommended standalone API. Lower-level packages such as checkpoint, memory, bootstrap, registry, and individual surface packages are installable for npm resolution but are not promoted as primary integration bricks unless their APIs are explicitly stabilized.

The package manager SSOT is the pnpm workspace graph in `pnpm-workspace.yaml`. Source manifests use `workspace:*` for internal `@yagr/*` dependencies. `pnpm pack` and Changesets publishing rewrite those workspace ranges to concrete npm versions in package artifacts, so published manifests must not contain `file:`, `link:`, or `workspace:` dependencies.

Changesets is the release SSOT. Stable releases are prepared through a Changesets version PR on `main` and are published to npm `latest` only from stable semver source manifests. `next` publishes are CI-only Changesets snapshot releases under the npm `next` dist-tag; snapshot or prerelease versions are not committed to source manifests.

For a VS Code extension, prefer this composition path:

- construct the agent from `@yagr/deepagent-bootstrap`
- resolve providers and models from `@yagr/provider-runtime`
- persist sessions and checkpoints with `@yagr/session-service`
- normalize LangGraph streams with `@yagr/stream-adapter`
- render progress and tool activity from `@yagr/runtime-events`
- record meaningful runtime effects with `@yagr/impact-ledger` and `@yagr/reality-observer`
- use `@yagr/plugin-runtime` for plugin contracts

`@yagr/session-service` is the stable checkpoint authority. It wraps `@yagr/session-checkpoint`, which persists native LangGraph checkpoint tuples, while the service owns UI-ready summaries, session metadata restore, checkpoint policy, and checkpoint lifecycle events.

## Root App Composition

The root `src/` tree assembles the `@yagr/agent` app and CLI.

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

- apps depend on granular runtime packages, or on facades only when convenience outweighs package-footprint concerns
- facades depend on internal core/surface packages
- plugins depend on plugin/runtime contracts
- core does not depend on product-specific integration behavior

## Runtime Context Capabilities

Manual context compaction is exposed by the root Yagr runtime handle through `CompactionService.compactSession(...)`. The service owns API/result normalization and per-session event state, while the actual compaction adapter remains tied to native DeepAgents.js summarization state (`_summarizationEvent` and `_summarizationSessionId`) rather than a separate Yagr summarizer.

Provider-reported context usage is surfaced as a runtime stream capability through `@yagr/runtime-events` and `@yagr/stream-adapter`. Surfaces consume `context-usage` events only when real provider/runtime usage metadata is available; surface-side estimates are not emitted by default.

## Integrator Note

If integrating Yagr into another product, prefer the granular runtime packages first. Reach for `@yagr/runtime` or `@yagr/surfaces` only when a convenience facade is genuinely preferable to explicit composition.
