<div align="center">

<table>
<tr>
<td align="center" width="180">
	<img src="res/yagr-logo.png" alt="Yagr logo" width="140">
</td>
<td align="left">

# Yagr

### Your autonomous agent. Grounded in reliable infrastructure.

**Autonomous automation agent · n8n backend today · native engine tomorrow**

</td>
</tr>
</table>

[![CI](https://github.com/EtienneLescot/n8n-as-code/actions/workflows/ci.yml/badge.svg)](https://github.com/EtienneLescot/n8n-as-code/actions/workflows/ci.yml)
[![Documentation](https://github.com/EtienneLescot/n8n-as-code/actions/workflows/docs.yml/badge.svg)](https://n8nascode.dev/)
[![Yagr Docs](https://img.shields.io/badge/docs-yagr-black?logo=gitbook)](https://n8nascode.dev/yagr/docs/)
[![n8n backend](https://img.shields.io/badge/backend-n8n-FE5A16?logo=n8n&logoColor=white)](https://n8n.io/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

<br>

**Yagr is the product layer.** It takes natural-language intent and turns it into live automations.

**n8n is the V1 execution engine.** Yagr uses the n8n-as-code stack as its bridge today, while keeping the product story stable for a future native Yagr engine.

[**Read Yagr docs**](https://n8nascode.dev/yagr/docs/) · [**Open n8n-as-code**](https://n8nascode.dev/n8n-as-code/) · [**Workflow GitOps docs**](https://n8nascode.dev/docs/)

</div>

---

## Quick Start

If you want to see Yagr working before reading the full product story, start here.

### 1. Install Yagr globally

```bash
npm install -g yagr@latest
# or: pnpm add -g yagr@latest
```

### 2. Run onboarding once

```bash
yagr onboard
```

This connects three things:

- your n8n backend
- your default model
- your gateway surfaces

### 3. Start the agent

```bash
yagr start
```

After setup, the day-to-day loop is:

```bash
yagr start
yagr gateway status
yagr telegram onboarding
```

If you are contributing from this repository instead of installing the product globally, use the repo-scoped dev flow:

```bash
npm install
npm run build --workspace=packages/yagr
npm run yagr:setup
npm run yagr:start
```

The repository dev scripts intentionally use `.yagr-test-workspace` so local development does not pollute your real Yagr home.

Read next if you want more than the fast path:

- [Yagr getting started](https://n8nascode.dev/yagr/docs/getting-started/)
- [Yagr command reference](https://n8nascode.dev/yagr/docs/reference/commands/)
- [n8n-as-code product page](https://n8nascode.dev/n8n-as-code/)

---

## Why Another Autonomous Agent?

Most AI agents today execute tasks by writing ephemeral scripts or firing blind API calls.

It works once, but it creates a black box:

- hard to audit
- hard to secure
- hard to maintain
- easy to break

Yagr takes a radically different approach.

Yagr is a general-purpose autonomous agent, but its execution layer is grounded in deterministic workflows.

When you ask Yagr to sort your emails, draft replies, monitor Stripe churn, or automate an operations loop, it should not disappear into a temporary Python script that nobody can inspect tomorrow.

Instead, Yagr dynamically architects, validates, and deploys a real workflow underneath the conversation.

That means Yagr is an **automation agent** where:

- you express intent in natural language
- Yagr plans against a grounded node ecosystem
- Yagr generates and validates a workflow on a deterministic execution backend
- the resulting workflow becomes durable, executable memory and muscle that Yagr can revisit later

For the user, it feels like magic chat.

For the engineer, it is auditable, inspectable, safer, and grounded in strict ontology rather than improvisation.

The workflow is the agent's durable memory and muscle.

---

## Why Yagr

<table>
<tr>
<td width="33%" valign="top">

### Intent First

Yagr starts from what you want to automate, not from manually wiring implementation primitives.

</td>
<td width="33%" valign="top">

### Workflows Remember

Generated workflows are not throwaway output. They are persisted intent that Yagr can inspect, explain, modify, and extend.

</td>
<td width="33%" valign="top">

### Engine Boundary

Yagr stays above the execution engine. Today that engine is n8n. Tomorrow it can be a native Yagr runtime.

</td>
</tr>
</table>

---

## What Yagr Is And Is Not

<table>
<tr>
<td width="50%" valign="top">

### Yagr Is

- an autonomous automation agent
- a product layer above the engine
- a stable runtime with a dedicated home
- a way to reach the same agent through TUI, Telegram, CLI, and future gateways

</td>
<td width="50%" valign="top">

### Yagr Is Not

- a monolithic n8n workflow pretending to be an agent
- a generic memory/notes/reminders product
- a pile of shell variables glued together
- a replacement for n8n-as-code workflow engineering tooling

</td>
</tr>
</table>

---

## Architecture In One View

```text
User intent
	-> Yagr agent
		-> Engine interface
			-> V1: n8n backend via n8n-as-code
			-> V2: native Yagr engine
				-> workflow is generated, validated, deployed
					-> workflow becomes durable executable memory
```

This separation is deliberate:

- gateways are thin surfaces
- the agent is the reasoning layer
- the engine executes automations
- workflows are the lasting artifact, memory, and muscle

---

## What Setup Actually Does

`yagr setup` configures three things:

1. your **V1 backend**: n8n instance, API key, project, local sync folder
2. your **default model**: provider, model, API key, optional base URL
3. your **gateway surfaces**: for example Telegram

Yagr stores that state in its own home so the product does not depend on whatever repo or shell happens to be open.

---

## Product Philosophy

- **Yagr is the agent.** n8n is the V1 execution backend.
- **Gateways are not the brain.** Telegram and TUI are surfaces into the same agent loop.
- **Workflows are memory and muscle.** They persist how the problem was solved and they execute it reliably over time.
- **The backend must stay swappable.** Moving from n8n to a native Yagr engine should be an engine change, not a product rewrite.

---

## Products In This Repository

| Product | Role | Where to go |
|---|---|---|
| **Yagr** | Autonomous automation agent | [Yagr docs](https://n8nascode.dev/yagr/docs/) |
| **n8n-as-code** | Workflow GitOps, AI skill, schema grounding, VS Code extension, TypeScript workflows | [n8n-as-code page](https://n8nascode.dev/n8n-as-code/) |

The previous root README for `n8n-as-code` is preserved as a dedicated product README in [products/n8n-as-code/README.md](products/n8n-as-code/README.md).

---

## Read Next

- [Yagr overview](https://n8nascode.dev/yagr/docs/)
- [Yagr getting started](https://n8nascode.dev/yagr/docs/getting-started/)
- [n8n-as-code product page](https://n8nascode.dev/n8n-as-code/)
- [n8n-as-code documentation](https://n8nascode.dev/docs/)
