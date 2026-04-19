<div align="center">

# Yagr

### (Y)our (A)gent (G)rounded in (R)eality

**The autonomous agent that turns intent into live n8n automations.**

<img src="res/yagr-logo.png" alt="Yagr logo" width="130">

[![CI](https://github.com/EtienneLescot/yagr/actions/workflows/ci.yml/badge.svg)](https://github.com/EtienneLescot/yagr/actions/workflows/ci.yml)
[![Documentation](https://github.com/EtienneLescot/yagr/actions/workflows/docs.yml/badge.svg)](https://yagr.dev/docs/)
[![Yagr Docs](https://img.shields.io/badge/docs-yagr-black?logo=gitbook)](https://yagr.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Setting up automation should not be harder than the automation itself.**

Yagr is the red-carpet experience for n8n --  <img src="n8n-color.png" alt="n8n" width="80" style="vertical-align: middle;">   -- a guided autonomous agent that takes you from a blank terminal to a live workflow, without the usual setup maze.

<table>
<tr>
<td width="50%" valign="top">

<strong>DIDACTIC WIZARD</strong><br><br>
Launch a guided TUI assistant that walks the setup from A to Z instead of dropping you into raw config screens.<br><br>
<em>Solves:</em> confusion, dead ends, and guesswork during first run.

</td>
<td width="50%" valign="top">

<strong>LOW PREREQUISITES</strong><br><br>
No pre-installed n8n required on the Docker-backed path. Yagr prepares and manages the local environment for you.<br><br>
<em>Solves:</em> manual n8n installation before you can even try the product.

</td>
</tr>
<tr>
<td width="50%" valign="top">

<strong>NO MANUAL CONFIG</strong><br><br>
Stop bouncing between terminals, dashboards, URLs, tokens, and env vars just to make the stack talk to itself.<br><br>
<em>Solves:</em> API-key scavenger hunts and setup sprawl.

</td>
<td width="50%" valign="top">

<strong>SHARED AUTH</strong><br><br>
The agent's own LLM connection powers compatible nodes automatically during workflow generation.<br><br>
<em>Solves:</em> repeated credential wiring across agent and workflow nodes.

</td>
</tr>
<tr>
<td width="50%" valign="top">

<strong>PROMPT-TO-EXECUTION</strong><br><br>
You describe what you want. Yagr builds, publishes, and runs the workflow for you.<br><br>
<em>Solves:</em> chat agents that stop at suggestions instead of delivering automation.

</td>
<td width="50%" valign="top">

<strong>AUTOLOGIN LINK</strong><br><br>
Jump straight back into the n8n canvas whenever you want to review or refine the result visually.<br><br>
<em>Solves:</em> black-box behavior and painful handoff from agent to editor.

</td>
</tr>
</table>

[**Read Yagr docs**](https://yagr.dev/docs/)

</div>

## Why It Hits Different

Most people do not want to spend their afternoon:

- installing n8n before they can even try the agent
- hunting for API keys and pasting them in five places
- wiring Docker manually just to get to hello world
- figuring out how to reuse their LLM inside workflow nodes
- losing the visual editor once the agent starts building things

Yagr removes that setup tax.

You describe what you want. Yagr helps prepare the environment, connects the model, builds the workflow, publishes it, runs it, and keeps the result editable in n8n.

The experience is meant to feel immediate:

1. install once
2. run the wizard
3. describe the automation
4. let the agent build it
5. open the canvas only when you want to refine visually

## Quick Start

Two commands. Then you automate.

### 1. Install Yagr

```bash
npm install -g @yagr/agent@latest
```

### 2. Run the wizard

```bash
yagr onboard
```

That guided TUI handles the full first-run flow:

- detects the environment
- bootstraps a local n8n when Docker is available
- connects your default model provider
- stores Yagr runtime state in its own home
- configures optional integrations such as Telegram
- gives you an autologin path back to the visual editor

After onboarding, operate Yagr day to day with:

```bash
yagr start           # start gateways in the background
yagr tui             # open a terminal chat session
yagr webui           # open the local web interface
yagr stop            # stop the background gateway
```

## Zero-Friction n8n

Yagr is designed so that the setup path reinforces the product promise instead of breaking it.

| What usually hurts | What Yagr does |
| --- | --- |
| "Install n8n first" | Boots and manages a local n8n for you when Docker is available |
| "Now add your API keys everywhere" | Reuses the agent's LLM connection for compatible workflow nodes |
| "Copy this token, then this URL, then this secret" | Centralizes onboarding in one guided TUI flow |
| "Open the browser and log in manually" | Gives you direct access back to the editor when you want to tweak visually |
| "Hope the agent did something sensible" | Produces real workflows you can inspect, edit, and run in n8n |

### Prerequisites

- **Node.js** `v22.16.0` or higher
- **Docker** if you want the full zero-friction local n8n experience

Docker is optional if you already have an n8n instance and want Yagr to connect to it instead.

## Why Yagr Is Different

Most autonomous agents execute tasks by writing ephemeral scripts or firing blind API calls.

That can work once, but it creates systems that are:

- hard to audit
- hard to secure
- hard to maintain
- easy to break

Yagr takes a different path.

When you ask Yagr to automate something, it should not disappear into an opaque one-off script. It should produce a real workflow you can inspect, run again, and improve over time.

That means:

- you start from intent, not node wiring
- the result becomes a real workflow, not a temporary trick
- execution stays inspectable in n8n
- the visual editor remains part of the loop

## Under The Hood

Yagr is designed to sit above the execution layer while keeping the product experience centered on n8n.

[n8n](https://github.com/n8n-io/n8n) is the automation engine behind Yagr today. The user story is simple: describe what you want, let the agent build the automation, then inspect and evolve the resulting workflow in n8n.

## Yagr And n8n-as-code

> <table>
> <tr>
> <td width="108" align="center">
> <img src="res/logo.png" alt="n8n-as-code logo" width="84">
> </td>
> <td>
> <strong>Yagr is built on top of n8n-as-code</strong><br>
> Yagr relies on n8n-as-code for workflow GitOps foundations, schema grounding, and editor tooling while presenting a higher-level autonomous agent product on top.<br><br>
> <a href="https://github.com/EtienneLescot/n8n-as-code">Open the n8n-as-code repository</a>
> </td>
> </tr>
> </table>

If you want direct workflow engineering, GitOps operations, schema-driven tooling, and editor-centric workflow development, n8n-as-code remains a standalone product in its own right.

Yagr keeps the product layer above the execution layer:

- gateways stay thin
- the agent remains the reasoning layer
- n8n executes the automation
- workflows become the durable artifact you can inspect and evolve

## What Setup Actually Configures

`yagr setup` and `yagr onboard` configure three things:

1. your **current orchestrator connection**: today that means an n8n instance, API key, project, and local sync folder
2. your **default model**: provider, model, API key, optional base URL
3. your **optional integrations**: for example Telegram

Yagr stores that state in its own home so the product is stable across sessions and independent from random shell state.

## Troubleshooting

If gateways are not responding or something feels stuck:

```bash
yagr stop
yagr gateway status
yagr start
```

If you need to expose a local n8n instance publicly for webhooks or Telegram triggers:

```bash
yagr n8n tunnel setup
yagr n8n tunnel url
yagr n8n tunnel refresh
yagr n8n tunnel stop
```

Yagr downloads and manages the `cloudflared` binary automatically. No Cloudflare account required.

To inspect or reset local state:

```bash
yagr paths
yagr reset --dry-run
yagr reset --scope full --yes
```

To remove the global CLI package itself:

```bash
npm uninstall -g @yagr/agent
```

## n8n Compatibility

> **Warning**
> The node schema bundled with n8n-as-code is built against the latest stable release of n8n. For best results, keep your n8n instance up to date. An outdated instance may render generated workflows with unsupported node type versions.

## Contributing And Development

If you are contributing from this repository instead of installing the published package globally, use the repo-scoped development flow:

```bash
npm install
npm run build
npm run yagr:onboard
npm run yagr:start
```

These scripts intentionally target `.yagr-test-workspace` so local development does not pollute your real `~/.yagr` home.

## Acknowledgments

Yagr is built on top of the incredible work from the n8n team.

[n8n](https://github.com/n8n-io/n8n) is a powerful and flexible workflow automation platform. Go show them some love.

## Read Next

- [Yagr overview](https://yagr.dev/)
- [Yagr getting started](https://yagr.dev/docs/getting-started/)
- [Yagr command reference](https://yagr.dev/docs/reference/commands/)
- [n8n-as-code repo](https://github.com/EtienneLescot/n8n-as-code)
- [n8n-as-code docs](https://n8nascode.dev/docs/)
- [n8n repo](https://github.com/n8n-io/n8n)
