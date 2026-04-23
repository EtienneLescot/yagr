# AGENT.md

This file describes the work rules and best practices to follow in this repo.

It complements the architectural documentation located in [architecture/README.md](./architecture/README.md).

Before any structural change, read in priority:

1. [architecture/current/system-overview.md](./architecture/current/system-overview.md)
2. [architecture/current/deepagents-agent.md](./architecture/current/deepagents-agent.md)
3. [architecture/current/module-map.md](./architecture/current/module-map.md)
4. [architecture/current/runtime-flows.md](./architecture/current/runtime-flows.md)
5. [architecture/target/backlog.md](./architecture/target/backlog.md)

## Guiding principles

- Keep code clean, maintainable over time, simple, and resilient.
- Do not reinvent the wheel without good reason.
- Favor clean architecture and explicit boundaries between layers.
- Respect SSOT everywhere.
- Avoid scattered code and logic duplication.
- Make abstractions only when they truly clarify responsibilities.

## Architecture rules

### 1. Clear responsibilities

Each block must have a clear primary responsibility.

In particular:

- the agentic loop must not absorb facade logic
- facades must not become the brain of the product
- setup must not be scattered across multiple surfaces
- the provider layer must not absorb high-level tooling logic

### 2. Mandatory SSOT

Every structural logic must have a clear authority source.

Examples:

- a path calculation must not be copied across several modules
- a config rule must not be reimplemented in the wizard, WebUI, and a gateway
- a provider policy must not exist half in the runtime and half in the provider

If a behavior must exist in multiple places, extract it rather than copy it.

### 3. Fine LLM providers and plugins

The target direction of the repo is:

- a standard layer of LLM providers
- providers added as plugins
- the thinnest possible provider logic layer

Each provider must contain only:

- its own configuration
- its model factory
- its auth/session mechanisms
- its strictly necessary specifics

Common logic must not be pushed into each provider.

### 4. Explicit tooling/providers interface

The interface between tooling and providers must be strong, readable, and centralized.

The repo must handle multiple levels of provider capabilities in tooling:

- strong providers with native tool calling
- partially compatible providers
- weak or fallback providers

This harmonization must be done in a common rational layer, not by stacking exceptions in each provider.

### 5. Thin facades

TUI, WebUI, Telegram, CLI, and future surfaces must remain thin.

They should mainly:

- receive inputs
- call appropriate services
- render outputs and events

They must not concentrate:

- configuration logic
- setup logic
- provider logic
- core business logic

### 6. Coherent setup

Setup, the wizard, and n8n bootstrap must converge toward unique setup services.

Do not duplicate onboarding logic between:

- the wizard
- the WebUI
- other surfaces

### 7. Orchestrator and automation backend

Yagr stays above the orchestrator.

- n8n is the main backend today
- the agentic core must not be drowned in n8n integration details
- backend contracts must remain clean and evolutive

## Documentation maintenance rules

### Current architecture

The `architecture/current/` folder must always describe the repo as it really exists.

Update it whenever a change modifies:

- a module's responsibilities
- cross-cutting flows
- structural dependencies between blocks
- a component's place in the architecture

### Target architecture

The `architecture/target/` folder is ephemeral.

It serves to:

- track only remaining work

It must be cleaned up as it goes:

- when a target becomes real, it is described in `architecture/current/`
- completed items must disappear from the target backlog
- obsolete target documentation must be deleted

## Expected reflexes before coding

- identify the logical block concerned
- verify if a SSOT already exists
- verify if similar logic already exists elsewhere
- verify if the change reinforces or destroys an architectural boundary
- update architectural documentation if the structure changes

## Warning signals

A change should be reconsidered if:

- it duplicates logic already present elsewhere
- it adds a provider-specific exception in a generic layer without strong need
- it moves core logic into a facade
- it adds undocumented transverse coupling
- it makes future evolution toward a clean plugin architecture more difficult

## Practical rule

When doubt exists between:

- quickly adding a new ad hoc layer
- or clarifying responsibility and extracting an authority point

prefer clarification and the authority point.
