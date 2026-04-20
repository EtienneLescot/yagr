<div align="center">

# Yagr

### (Y)our (A)gent (G)rounded in (R)eality

**An autonomous agent that turns intent into real, running automations.**

<img src="res/yagr-logo.png" alt="Yagr logo" width="130">

[![CI](https://github.com/EtienneLescot/yagr/actions/workflows/ci.yml/badge.svg)](https://github.com/EtienneLescot/yagr/actions/workflows/ci.yml)
[![Documentation](https://github.com/EtienneLescot/yagr/actions/workflows/docs.yml/badge.svg)](https://yagr.dev/docs/)
[![Yagr Docs](https://img.shields.io/badge/docs-yagr-black?logo=gitbook)](https://yagr.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

<p align="center">
  <a href="https://yagr.dev/"><strong>Docs</strong></a> ·
  <a href="https://yagr.dev/docs/getting-started/"><strong>Getting Started</strong></a> ·
  <a href="https://yagr.dev/docs/reference/commands/"><strong>Commands</strong></a>
</p>

---

## What Yagr Is

Yagr is an autonomous agent managing resilient orchestration — not fragile scripts.

It builds **durable workflows** that execute, persist, and remain inspectable.

You describe what you want. Yagr turns it into a working system.

* **agent** → decides
* **n8n** → executes
* **workflow** → persists

---

## Why Yagr Exists

Setting up automation should not be harder than the automation itself.

Two problems block adoption.

### The setup tax

* installing and configuring n8n before a first result
* wiring Docker just to get started
* pasting API keys across multiple surfaces
* managing URLs, tokens, and environment state

### Agents that don’t build systems

Most agents generate scripts that are:

* ephemeral
* hard to audit
* difficult to review
* loosely secured

They execute once and disappear. They do not produce systems you can trust or evolve.

---

### Yagr takes a different path

Yagr removes the setup tax and replaces scripts with workflows.

It relies on orchestration rather than ad-hoc execution:

1. prepares the environment
2. connects your model
3. builds the workflow
4. publishes it to n8n
5. runs it
6. keeps it editable in the visual canvas

> The result is not a suggestion — it is a working system.

---

| Problem           | With Yagr            |
| ----------------- | -------------------- |
| Setup friction    | Automated onboarding |
| Ephemeral scripts | Durable workflows    |
| Hidden execution  | Inspectable systems  |

---

## Quick Start

### Install

```bash
npm install -g @yagr/agent@latest
```

### Onboard

```bash
yagr onboard
```

The onboarding flow handles:

* environment detection
* n8n setup via Docker when available
* model configuration
* local runtime initialization
* optional integrations
* access to the visual editor

---

## Example (30 seconds)

Create a workflow that sends a Slack message when a Stripe payment succeeds.

```bash
yagr tui
```

Then type:

> "Send me a Slack message every time a Stripe payment succeeds"

Yagr will:

* connect Stripe
* create the trigger
* add the Slack action
* deploy the workflow to n8n
* run it

Open the visual editor to inspect or refine it.

---

## Daily Usage

```bash
yagr start     # start services
yagr tui       # open terminal chat
yagr webui     # open web interface
yagr stop      # stop services
```

---

## Zero-Friction n8n

| What usually hurts      | What Yagr does                      |
| ----------------------- | ----------------------------------- |
| Install n8n first       | Boots and manages a local instance  |
| Add API keys everywhere | Reuses the agent's model connection |
| Copy tokens and URLs    | Centralizes setup in one flow       |
| Manual login            | Direct access to the editor         |
| Hope it worked          | Produces inspectable workflows      |

---

## Prerequisites

* **Node.js** `v22.16.0` or higher
* **Docker** (optional, for local n8n bootstrap)

---

## Why Yagr Is Different

Most agents execute work through ephemeral scripts or hidden API calls.

That may work once. It does not produce a system.

Yagr produces workflows you can inspect, run again, and evolve.

* execution stays visible
* behavior remains inspectable
* systems improve over time

---

## Under the Hood

Yagr sits above the execution layer while staying grounded in n8n.

* agent → reasoning
* n8n → execution
* workflow → durable artifact

---

## Yagr and n8n-as-code

> <table>
> <tr>
> <td width="108" align="center">
> <img src="res/logo.png" alt="n8n-as-code logo" width="84">
> </td>
> <td>
> <strong>Built on n8n-as-code</strong><br>
> Provides schema grounding, GitOps workflows, and editor tooling.<br><br>
> <a href="https://github.com/EtienneLescot/n8n-as-code">Explore the repo</a>
> </td>
> </tr>
> </table>

---

## What Setup Configures

`yagr onboard` sets up:

1. orchestrator connection
2. model provider
3. integrations

---

## Troubleshooting

```bash
yagr stop
yagr gateway status
yagr start
```

```bash
yagr n8n tunnel setup
yagr n8n tunnel url
```

```bash
yagr reset --scope full --yes
```

---

## Contributing

```bash
npm install
npm run build
npm run yagr:onboard
npm run yagr:start
```

---

## Read Next

* [https://yagr.dev/docs/](https://yagr.dev/docs/)
* [https://github.com/EtienneLescot/n8n-as-code](https://github.com/EtienneLescot/n8n-as-code)
* [https://github.com/n8n-io/n8n](https://github.com/n8n-io/n8n)
