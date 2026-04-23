# System Overview

This page describes the repository as it exists now after the package split.

## Current architectural model

```mermaid
flowchart TD
    User[User]

    subgraph Apps[Apps]
      AgentApp[@yagr/agent]
    end

    subgraph Facades[Facade Packages]
      RuntimeFacade[@yagr/runtime]
      SurfacesFacade[@yagr/surfaces]
    end

    subgraph Core[Core Runtime Packages]
      Bootstrap[@yagr/deepagent-bootstrap]
      Provider[@yagr/provider-runtime]
      Session[@yagr/session-service]
      Events[@yagr/runtime-events]
      Stream[@yagr/stream-adapter]
      Conversation[@yagr/conversation-service]
    end

    subgraph SurfacePackages[Surface Packages]
      WebuiSurface[@yagr/webui-surface]
      TuiSurface[@yagr/tui-surface]
    end

    subgraph Plugins[Plugins]
      PluginRuntime[@yagr/plugin-runtime]
      N8nManager[@yagr/plugin-n8n-manager]
    end

    User --> AgentApp
    AgentApp --> RuntimeFacade
    AgentApp --> SurfacesFacade
    RuntimeFacade --> Bootstrap
    RuntimeFacade --> Provider
    RuntimeFacade --> Session
    RuntimeFacade --> Events
    RuntimeFacade --> Stream
    RuntimeFacade --> Conversation
    SurfacesFacade --> WebuiSurface
    SurfacesFacade --> TuiSurface
    AgentApp --> PluginRuntime
    PluginRuntime --> N8nManager
```

## Key points

- The current app package is still `@yagr/agent`.
- The repository now exposes reusable runtime and surface packages.
- The preferred product-facing entrypoints are the facades:
  - `@yagr/runtime`
  - `@yagr/surfaces`
- Manager-specific behavior is starting to move behind `@yagr/plugin-n8n-manager`.

## What Yagr core owns now

Yagr core owns:

- deepagent bootstrap
- provider/model runtime
- sessions/checkpoints
- runtime events
- stream adaptation
- conversation/slash behavior
- reusable surface primitives

## What is no longer the right mental model

It is no longer accurate to think of Yagr as:

- one agent app
- plus a loose set of helper modules

The more accurate model is:

- a reusable runtime platform
- with plugins
- with apps assembled on top
