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
    end

    subgraph ExternalN8n[External n8n-as-code Ecosystem]
      WorkflowCore[n8n-as-code workflow-core]
      N8nFacades[n8n-as-code/n8nac facades]
      ExternalManager[n8n-as-code/n8n-manager]
      Credentials[n8n-credentials-manager]
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
    N8nFacades --> WorkflowCore
    N8nFacades --> ExternalManager
    ExternalManager --> Credentials
```

## Key points

- The current app package is still `@yagr/agent`.
- The repository now exposes reusable runtime and surface packages.
- The preferred product-facing entrypoints are the facades:
  - `@yagr/runtime`
  - `@yagr/surfaces`
- Manager-specific behavior has moved out of this repository.
- The external n8n ecosystem now has two independent engines:
  - `n8n-as-code workflow-core` for workflow intelligence
  - `n8n-manager` for runtime, infrastructure, diagnostics, credentials, deploy, and execution
- User-facing facades such as `n8nac`, the VS Code/Cursor extension, MCP, Claude/OpenClaw plugins, and Yagr integrations can orchestrate both engines.
- Yagr only keeps optional adapters such as `YAGR configured LLM` as a generic `LlmSource`.

## What Yagr core owns now

Yagr core owns:

- deepagent bootstrap
- provider/model runtime
- sessions/checkpoints
- runtime events
- stream adaptation
- conversation/slash behavior
- reusable surface primitives

Yagr core does not own the generic n8n credentials manager. The external `n8n-manager` repo owns credential recipes, starter kits, inventory status, and the generic LLM proxy credential contract. The same runtime-readiness behavior that was first available through Yagr should become available through all n8n-as-code facades.

## What is no longer the right mental model

It is no longer accurate to think of Yagr as:

- one agent app
- plus a loose set of helper modules

The more accurate model is:

- a reusable runtime platform
- with plugins
- with apps assembled on top
