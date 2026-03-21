# N8N Local Bootstrap For Yagr

## Goal

Reduce first-run friction by letting Yagr handle the n8n bootstrap path itself instead of assuming the user already has:

- an n8n account
- a running local or cloud instance
- an API key
- a project ready for `n8nac`

The onboarding should offer two explicit paths:

1. use an existing n8n instance
2. install and use a new local n8n instance

Path 1 already exists in Yagr and should be improved. Path 2 is the main opportunity.

## Current State In Yagr

Today the setup wizard starts directly at:

- n8n URL
- n8n API key
- n8n project
- sync folder

This means Yagr currently assumes the instance already exists and is already operator-ready.

Concretely:

- [`src/setup/setup-wizard.tsx`](/home/etienne/repos/yagr/src/setup/setup-wizard.tsx) models only the "existing instance" path
- [`src/setup.ts`](/home/etienne/repos/yagr/src/setup.ts) tests connectivity through `N8nApiClient`, then persists host/API key/project
- [`docs/yagr-docs/usage/n8n-backend.md`](/home/etienne/repos/yagr/docs/yagr-docs/usage/n8n-backend.md) documents only a pre-existing n8n connection

## Product Principles

- Yagr should behave as the installer, operator, and default user of the local n8n instance.
- The user may still open and use n8n directly, but that should be optional.
- The default path must optimize for minimum friction, not for maximum infrastructure purity.
- Yagr should manage what it creates under `YAGR_HOME`.
- Yagr should not silently perform highly intrusive machine-level installs such as installing Docker Desktop or system package managers without explicit consent.
- The flow must degrade cleanly when the machine is missing prerequisites.

## Recommendation

Use a two-tier local bootstrap strategy:

1. preferred path: managed Docker-based n8n if Docker is already available
2. fallback path: managed direct local n8n runtime if Docker is unavailable but Node.js is available

Do not make Yagr install Docker automatically.

## Product North Star

The target hierarchy should be explicit:

1. `Silent` for a Yagr-managed local n8n instance
2. `Assisted` for a Yagr-managed local n8n instance when fully silent bootstrap is not yet possible
3. `Guided` for an existing instance, especially cloud or operator-managed instances

This should drive product decisions. The best Yagr experience is not merely "connect to n8n", but "Yagr owns and operates its own isolated orchestration runtime by default".

That positioning is strategically strong because it means:

- Yagr can offer a near-zero-friction first run
- Yagr can keep its automation substrate isolated from the user's other n8n environments
- Yagr can manage upgrades, credentials, health, and lifecycle consistently
- existing user-managed or company-managed n8n instances remain supported as an integration path, not as the primary experience

### Why Docker First

Pros:

- best isolation from the user machine
- consistent across macOS, Linux, and Windows
- easier version pinning
- easier restart/health/log management
- lower risk of polluting the user's Node environment
- clean place to persist n8n data volumes

Cons:

- Docker may not be installed
- first-time Docker setup is itself a source of friction
- on Windows/macOS it may require Docker Desktop and admin rights

### Why Direct Runtime As Fallback

Pros:

- no Docker dependency
- can be started quickly when Node is already present
- simpler for power users or locked-down laptops where Docker is unavailable

Cons:

- weaker isolation
- more dependency/version drift risk
- more OS-specific process supervision edge cases
- harder long-term upgrade hygiene than a containerized runtime

## What Yagr Should And Should Not Install

### Yagr should manage automatically

- a dedicated local n8n working directory under `YAGR_HOME`
- pinned n8n version metadata
- runtime config and generated secrets
- process lifecycle: install, start, stop, restart, status, logs
- health checks against local HTTP endpoints
- persistence location for n8n user data
- post-install connection of Yagr to that local instance

### Yagr should not do silently

- install Docker Desktop or Docker Engine
- install system services globally
- change firewall settings without consent
- expose the instance publicly by default

## Recommended UX

Inside `yagr onboard`, replace the current first step with:

1. `Use an existing n8n instance`
2. `Install a local n8n instance`

### Existing Instance Path

Keep the current behavior, but improve guidance:

- show examples for `http://localhost:5678`
- explain how to find the API key
- provide a short note for n8n Cloud users
- provide a short note for local quickstart users
- detect common URL mistakes and normalize them

### Local Install Path

Suggested flow:

1. detect OS, Docker availability, Node availability, port 5678 occupancy
2. choose install strategy automatically:
   - Docker if available
   - otherwise direct runtime if compatible Node is available
   - otherwise show the shortest prerequisite step
3. create local Yagr-managed n8n home
4. install or pull n8n
5. start n8n
6. wait for health readiness
7. bootstrap owner account and API access
8. select or create project
9. persist Yagr config
10. continue into LLM and surfaces setup

## Cross-Platform Runtime Layout

Use a dedicated subtree under `YAGR_HOME`, for example:

```text
YAGR_HOME/
  n8n/
    instance.json
    compose.yaml
    env
    logs/
    data/
    direct-runtime/
```

`instance.json` should be the single source of truth for:

- strategy: `docker` or `direct`
- version
- local URL
- bind port
- created-at
- health state
- owner bootstrap state
- API key bootstrap state

## Bootstrap Ownership And Credentials

This is the hardest part.

Yagr already needs:

- a reachable n8n URL
- an API key
- a project

The local installer should aim to produce these automatically, but there is an important constraint: n8n's official user-management flow starts with an owner signup in the app, then API key creation in settings.

Implication:

- fully silent bootstrap is risky if it depends on undocumented endpoints
- browser/UI automation is possible, but brittle
- the cleanest product behavior is "mostly automatic bootstrap with one minimal confirmation step if required"

### Recommended Credential Strategy

Phase 1:

- Yagr creates and starts the instance
- Yagr opens a tightly guided bootstrap step for owner creation if n8n requires it
- immediately after login, Yagr guides or automates API key capture as far as officially supported flows allow
- Yagr stores generated credentials in its own home

Phase 2:

- investigate whether owner creation and personal API key generation can be automated through stable documented APIs or a supported local bootstrap mechanism
- if not, keep one short human checkpoint and optimize around it rather than fighting the product

### Product Rule

If one human step remains unavoidable, it must be:

- late in the flow
- single-purpose
- explained in one screen
- immediately resumed by Yagr after completion

## API Key Creation And Recovery

This is a distinct friction point and should be treated as a first-class feature.

Officially, n8n documents API key creation from the UI:

- log in
- go to `Settings > n8n API`
- create a key
- copy it once

That means Yagr should not assume a clean documented server-side API exists for creating or reading a personal API key without an authenticated UI session.

### Product Goal

The user should not need to manually:

- navigate inside n8n
- decide where the API key screen lives
- create a label
- copy the key
- paste it back into Yagr

### Recommended Approach For A Yagr-Managed Local Instance

Preferred order:

1. Yagr creates and starts local n8n
2. Yagr attempts a fully silent owner/API bootstrap using only stable supported mechanisms
3. if silent bootstrap is not safely available, Yagr falls back to assisted owner/API setup
4. if assisted setup is not possible on the current machine, Yagr reduces the human action to a single tightly guided checkpoint without requiring copy-paste if possible

For a Yagr-managed local instance, the practical target should be:

- zero manual navigation
- zero manual labeling
- zero manual pasting
- ideally zero manual clicks

This is the royal path and should be treated as the default product ambition, not as a stretch nice-to-have.

If browser-assisted automation is needed, it should be limited to the Yagr-created local instance and be explicit to the user.

### Recommended Approach For An Existing Instance

For an already existing n8n instance, there are stricter boundaries:

- Yagr should not assume admin control
- Yagr should not silently automate someone else's browser session
- Yagr should not scrape credentials from a remote/cloud session without explicit consent

So the recommended product behavior is:

1. ask whether the user wants assisted API-key setup
2. open the exact `Settings > n8n API` page or explain the shortest path
3. prefill the desired label recommendation in copy, such as `Yagr`
4. allow a future assisted-browser path only with explicit opt-in

### Engineering Rule

There are three automation levels here:

1. `Guided`: Yagr opens the right page and explains one action
2. `Assisted`: Yagr drives the local browser session with explicit user consent
3. `Silent`: Yagr creates and captures the key entirely without the browser

Recommendation:

- support `Guided` for all instances
- support `Assisted` for Yagr-managed local instances as the first fallback
- treat `Silent` for Yagr-managed local instances as the primary target, provided it relies on a stable supported mechanism

### Security Rule

Any API key that Yagr creates or captures must be:

- stored only in Yagr-managed credential storage
- shown to the user only when necessary
- revocable by a dedicated Yagr command later
- clearly tagged or labeled so it can be identified in n8n

Suggested label format:

- `Yagr local agent`
- `Yagr <hostname>`
- `Yagr <date>`

### Suggested Follow-Up Commands

Add commands such as:

- `yagr n8n auth create-key`
- `yagr n8n auth rotate-key`
- `yagr n8n auth test`
- `yagr n8n auth doctor`

## Strategy Decision Matrix

### Option A: Docker only

Good:

- cleanest runtime management
- most resilient ongoing operations

Bad:

- blocks too many first-time users
- fails hard on machines without Docker

Verdict:

- not acceptable as the only path

### Option B: direct runtime only

Good:

- shortest path on machines with Node

Bad:

- more fragile across OSes
- weaker isolation
- more support burden

Verdict:

- not acceptable as the only path

### Option C: Docker preferred, direct fallback

Good:

- best balance of resilience and adoption
- keeps Yagr in control
- avoids making Docker a hard prerequisite

Bad:

- more implementation work

Verdict:

- recommended

## Proposed Implementation Phases

### Phase 0: UX improvement for existing-instance flow

- add a first-choice screen between existing-instance and local-install
- improve copy for n8n Cloud and local quickstart
- add validation hints and friendlier error messages

### Phase 1: local instance manager

Add a new service layer, for example:

- `src/n8n-local/manager.ts`
- `src/n8n-local/detect.ts`
- `src/n8n-local/docker.ts`
- `src/n8n-local/direct.ts`
- `src/n8n-local/state.ts`

Responsibilities:

- detect environment capabilities
- create instance state
- install/start/stop/status/logs
- expose resolved local URL to setup

### Phase 2: setup wizard integration

Extend [`src/setup/setup-wizard.tsx`](/home/etienne/repos/yagr/src/setup/setup-wizard.tsx) with phases like:

- `n8n-mode`
- `n8n-local-check`
- `n8n-local-installing`
- `n8n-local-starting`
- `n8n-local-bootstrap`
- `n8n-local-ready`

Then jump into the existing project/sync-folder path once the instance becomes API-ready.

### Phase 3: owner/API bootstrap minimization

Introduce a dedicated guided screen that:

- tells the user exactly what is happening
- opens the local instance URL if needed
- polls until setup is complete
- resumes automatically when the instance is usable

### Phase 4: lifecycle commands

Add CLI commands such as:

- `yagr n8n status`
- `yagr n8n start`
- `yagr n8n stop`
- `yagr n8n logs`
- `yagr n8n reinstall`
- `yagr n8n doctor`

This turns the local n8n runtime into a first-class managed subsystem.

## Technical Details By Strategy

### Docker Strategy

Yagr should:

- detect `docker` availability
- create a dedicated compose file under `YAGR_HOME`
- pin the n8n image version
- mount a dedicated persistent data directory
- bind to localhost only by default
- manage start/stop through non-interactive CLI calls

Suggested defaults:

- host: `127.0.0.1`
- port: `5678` or next free port
- public exposure: disabled
- persistence: under `YAGR_HOME/n8n/data`

### Direct Strategy

Yagr should:

- detect compatible Node availability
- install or run a pinned n8n version inside a Yagr-managed directory
- never rely on random global `npm` state
- supervise the child process
- store logs and PID/state metadata under `YAGR_HOME`

Avoid:

- assuming globally installed `n8n`
- assuming `npx n8n` without version pinning is stable enough for production onboarding

## Security Defaults

- bind to localhost only
- generate strong random secrets for any local runtime secret material
- do not expose the UI externally unless the user asks
- keep credentials in Yagr-managed storage only
- make reset/removal explicit and scoped

## Operational Risks

### High risk

- over-automating owner/API bootstrap against unstable internal endpoints
- trying to install Docker automatically
- relying on a globally installed `n8n`

### Medium risk

- port conflicts
- antivirus or local security tooling on Windows
- Docker Desktop not started even when installed
- Node version incompatibilities for direct runtime

### Lower risk

- local data path creation
- Yagr-side config persistence
- lifecycle commands and health polling

## Short-Term Recommendation

Ship in this order:

1. better branching UX in onboarding
2. local instance manager with Docker preferred and direct fallback
3. explicit architecture for silent local bootstrap, even if the first shipped version still falls back to assisted
4. assisted owner/API bootstrap checkpoint for Yagr-managed local instances
5. guided API flow for existing/cloud instances
6. first-class lifecycle commands

The priority order of user experiences should remain:

1. Yagr-managed local silent
2. Yagr-managed local assisted
3. existing-instance guided

## Bottom Line

If the goal is radical friction reduction without becoming recklessly invasive, the right approach is:

- Yagr-managed local n8n
- Docker when already available
- direct runtime fallback when Docker is absent
- no automatic Docker installation
- silent bootstrap as the north star for the Yagr-managed local path
- assisted bootstrap as the immediate fallback for the Yagr-managed local path
- guided bootstrap for existing/cloud instances
- as much automation as possible around startup, persistence, health, credentials, and config

That gives Yagr a realistic path to acting as the installer, operator, and effective admin of n8n, while staying robust across macOS, Linux, and Windows.
