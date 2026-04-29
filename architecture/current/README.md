# Current Architecture

The current architecture documents Yagr as an autonomous local coding-agent runtime.

Read in priority:

1. `system-overview.md`
2. `deepagents-agent.md`
3. `module-map.md`
4. `runtime-flows.md`

Core invariants:

- the agent core remains domain-agnostic
- facades stay thin
- setup owns provider and surface configuration only
- external tools are project-level dependencies, not built-in runtime coupling
