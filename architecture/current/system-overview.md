# System Overview

This repository is now a local autonomous coding-agent runtime.

## Current Architectural Model

```mermaid
flowchart TD
    User[User]

    subgraph App[App]
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
```

## Core Ownership

Yagr owns:

- deepagent bootstrap
- coding-oriented middleware
- generic Agent Skills installation and source-path resolution
- local shell and file execution semantics
- provider/model runtime
- sessions/checkpoints
- runtime events
- stream adaptation
- conversation/slash behavior
- reusable surface primitives

Yagr does not own domain-specific backends. External systems can still be used by the agent through ordinary local shell and file operations when the user asks, but no such backend is part of the built-in architecture.

## Mental Model

Yagr is:

- a local autonomous coding agent
- a reusable runtime platform
- a set of thin local and remote chat surfaces
- provider/runtime/session infrastructure for coding work

Installed Agent Skills are external instructions. Yagr stores and exposes skill directories, while DeepAgents.js owns runtime discovery and progressive disclosure.
