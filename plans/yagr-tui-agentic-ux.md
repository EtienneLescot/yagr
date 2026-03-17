# Yagr Agentic TUI UX Direction

## Goal

Build a TUI that feels deliberate, cinematic, and calm under load.

The objective is not to show more agent output. The objective is to make the user always understand three things at a glance:

1. what Yagr is doing now
2. whether the run is healthy or blocked
3. what the user should do, if anything

## External Signals

The strongest patterns across modern agentic terminal tools and terminal UI libraries are consistent:

- state and permission boundaries must stay explicit
- streaming text is useful, but only as a primary surface for the final answer, not for every internal event
- progress should be legible from a stable frame, not only from scrolling logs
- command output, reasoning traces, and required actions should be visually separated
- the UI should degrade gracefully on weaker terminals and smaller widths
- beauty in TUIs comes more from spacing, rhythm, hierarchy, and restraint than from raw ANSI excess

Relevant references used for this direction:

- Claude Code docs: strong separation between plan mode, thinking visibility, permissions, notifications, resume, and session identity
- Bubble Tea and Charm ecosystem patterns: explicit model state, stable view, composable panes, responsive terminal layout
- Lip Gloss guidance: adaptive colors, width-aware rendering, graceful downsampling, layered layout primitives
- Gum patterns: clear single-purpose interaction surfaces for confirm, filter, choose, input, pager, and styled summaries

## Diagnosis Of The Current Yagr UI

Current baseline in [packages/yagr/src/gateway/interactive-ui.tsx](/home/etienne/repos/n8n-as-code/packages/yagr/src/gateway/interactive-ui.tsx):

- good:
  - explicit state and phase labels already exist
  - command output is separated from normal responses
  - required actions are already surfaced
  - shortcuts already exist for thinking and execution visibility
- weak points:
  - most information is emitted into one scrolling feed
  - phase, health, and next-action signals are visually too small compared to log volume
  - assistant output and operational telemetry compete for attention
  - the screen has no strong composition or persistent landmarks
  - execution logs currently read like raw transport rather than curated narrative
  - the interface feels like a transcript viewer more than an instrument panel

## Core Product Decisions

These are the decisions Yagr should follow.

### 1. The TUI Should Be Frame-First, Not Feed-First

The screen should always have persistent regions:

- header: identity, model, run health, current phase, context pressure
- main stage: the current answer or current required action
- side rail: compact timeline of what Yagr has already done
- footer: input, active shortcuts, permission mode

The scrolling transcript becomes a secondary artifact, not the core visual experience.

Important clarification:

- secondary does not mean hidden or debug-only
- power users must be able to inspect the full operational trail directly inside the interface
- Yagr should therefore be frame-first at the top level, while still exposing integrated scrollback on demand

### 2. There Should Be Four Message Lanes, Not One

Every emitted event should map to one lane:

- narrative: what Yagr understands and intends to do
- action: concrete tool or command execution
- result: validated outcomes, file writes, deploys, verification, summary
- interrupt: permission requests, missing input, errors, resumable blockers

These lanes must be styled differently and rendered differently.

Narrative should feel editorial.
Action should feel mechanical.
Interrupt should feel impossible to miss.

These lanes should remain queryable through the integrated history surface so the user can reconstruct what happened without leaving the TUI.

### 2.1 The TUI Must Preserve Integrated Scrollback

This is a product requirement, not a debugging nicety.

Decision:

- the user must be able to scroll back through prior events from inside the interface
- this must work in normal operation, without enabling a verbose or debug mode first
- the main stage should stay curated, but a history pane or log browser must always be one interaction away
- history should preserve chronology, event type, and key payload excerpts

The right mental model is not “one screen or the other”. It is “beautiful live cockpit plus built-in flight recorder”.

### 3. Thinking Must Be Secondary By Default

Reasoning visibility should exist, but it should not dominate the screen.

Decision:

- default surface: concise narrative events only
- optional expanded surface: thinking trace or internal phase commentary
- never mix internal thinking with final answer typography

If shown, thinking should be dim, compressed, and collapsible in spirit even if implemented as a simple toggle first.

### 4. Command Output Must Be Curated Before Display

Raw stdout is rarely beautiful.

Decision:

- show command start immediately
- stream only meaningful output lines while the command is running
- collapse noisy blocks behind a compact summary when they are not actionable
- always end with a single verdict line: success, failure, exit code, artifact, duration

The user should feel that Yagr is translating terminal noise into operational meaning.

But curation must not destroy inspectability.

Decision:

- the live surface shows curated output
- the history surface keeps the richer event trail
- long command output can be collapsed in the main UI while remaining expandable in history

### 5. Required Actions Must Become Full-Screen Moments

If Yagr needs permission or user input, that event should visually take over the interface.

Decision:

- required actions get a dedicated banner card with a strong border and distinct color
- the primary suggested action is explicit
- keyboard affordance is visible in the same block
- the run timeline remains visible, but visually recedes

### 6. Streaming Assistant Output Should Feel Premium

The live answer should not look like raw token drip.

Decision:

- stream into a dedicated response panel
- preserve whitespace and paragraph rhythm
- use a stronger typographic treatment for the final committed answer than for intermediate deltas
- once finalized, move the answer into a durable “latest response” card rather than dumping it into the same log list as everything else

### 7. The UI Needs A Strong Visual Identity

Yagr should not look like a generic green-on-black chat terminal.

Decision:

- use a restrained palette with one atmospheric base hue, one warm activity hue, one alert hue, one success hue
- avoid rainbow semantics for every event
- rely on spacing, borders, dimming, and typography contrast as much as on color
- use box drawing characters intentionally, not everywhere

Recommended visual direction:

- base: mineral slate / petroleum blue
- active: amber or electric saffron
- success: mineral green, not neon green
- alert: ember or vermilion
- accent: pale ice or soft cyan

The tone should be closer to a high-end observability console than to a hacker movie terminal.

### 8. Session Identity Matters

Agent sessions are long-lived. The TUI should make them feel nameable and resumable.

Decision:

- display a session title in the header
- show current workspace or branch in compact form
- show a compact “resumable” or “clean” badge
- later add explicit rename and resume surfaces

### 9. Context Pressure Should Be Visible But Calm

Compaction is now part of the runtime. The user should see it without anxiety.

Decision:

- expose a small context meter in the header
- when compaction happens, show one elegant event in the timeline
- never flood the feed with token arithmetic

### 10. Empty State Must Be Designed, Not Ignored

The first screen sets the tone.

Decision:

- replace plain helper copy with a composed hero state
- include one short sentence about what Yagr can do
- include 3 prompt starters
- include the key shortcuts in a light, low-noise ribbon

## Message Transmission Rules

These rules should govern how Yagr talks to the user in the TUI.

### Narrative Rules

- narrate phase transitions only when they change meaning for the user
- prefer “I’m verifying the generated workflow” over “phase changed to verify”
- do not echo every internal step into the visible feed
- compress repeated behavior into one evolving status card when possible

### Action Rules

- show tool or command name
- show target artifact when known
- avoid dumping full argument payloads unless debugging mode is on
- convert command lifecycle into: start, key output, verdict

### Result Rules

- write outcomes as factual receipts
- mention file paths, validation status, push status, and verification state explicitly
- make success messages shorter than failure messages

### Interrupt Rules

- one interrupt should dominate the screen until resolved
- explain why the run is blocked
- explain the smallest user action needed to resume
- do not bury the permission question inside the scrolling transcript

### Tone Rules

- calm, sparse, confident
- no noisy filler like “working...” repeated in multiple places
- no exuberant celebratory copy after routine success
- errors should be sharp and actionable, never theatrical

## Proposed Screen Architecture

### Header Band

Always visible.

Contains:

- Yagr wordmark or compact identity mark
- session title
- state badge
- phase badge
- model badge
- context meter
- optional branch or workspace badge

### Main Stage

Primary panel.

Modes:

- live response
- required action card
- summary card after completion
- diagnostic card after failure

This is the emotional center of the UI.

### Timeline Rail

Secondary panel on wide terminals, stacked above footer on narrow terminals.

Contains compact event cards for:

- inspected repo
- found relevant files
- edited workflow
- validated
- synced
- verified
- compacted context

Each card should be one to three lines max.

This rail is not enough on its own for power users. It is the summary layer, not the forensic layer.

### History Surface

Yagr should include a dedicated in-app history surface.

Recommended shape:

- on wide terminals: a toggleable right-hand drawer or lower split pane
- on narrow terminals: a focus mode that temporarily turns the main stage into a scrollable history browser

Recommended content:

- chronological event stream
- lane badge: narrative, action, result, interrupt
- timestamp or relative ordering marker
- compact previews of command output and summaries
- clear visual markers for phase transitions, compactions, approvals, failures, and retries

Recommended controls:

- open or close history with a single shortcut
- scroll using arrow keys, page navigation, and jump-to-latest
- filter later by lane, but not required for V1

This keeps the beautiful composed experience while still respecting the needs of users who want to audit the agent live.

### Activity Drawer

Optional expanded region for:

- command output
- hidden thinking
- detailed logs

This should be off or minimized by default.

Important distinction:

- hidden thinking can remain optional
- detailed operational history should not be treated as debug-only
- the drawer, split pane, or history mode should therefore be considered a normal navigation surface

### Composer Footer

Contains:

- prompt input
- current mode hint
- essential shortcuts only

Avoid long slash-command cheat sheets in the permanent footer. Move the long list to a help overlay later.

## Recommended Visual Grammar

### Spacing

- prefer generous vertical spacing between semantic blocks
- avoid dense stacked labels
- keep header compact and main stage breathable

### Borders

- use borders for panels and interrupt states
- avoid boxing every feed item
- mix bordered and borderless regions to create hierarchy

### Typography In Terminal Terms

- primary answer: bright, normal weight emphasis only where needed
- metadata: dim
- labels: short uppercase or title-case tags
- command output: monospace default, no extra decoration

### Color System

- success and failure colors reserved for outcomes
- amber reserved for active work or waiting
- cyan or ice reserved for identity and navigational chrome
- narrative text should mostly stay neutral

### Motion

Terminal motion should be subtle.

- reveal phase changes through replacing a badge or card, not through flicker
- stream into one stable panel rather than pushing the whole layout around
- if animation is added later, it should be soft and sparse

## Concrete UI Plan For Yagr

### V1 Cosmetic Redesign

Keep Ink. Do not change runtime semantics.

Implement:

- a real header band with badges and context area
- a main response card
- a compact activity timeline instead of a flat feed
- an integrated history browser with scrollback available in normal mode
- a dedicated required-action banner
- quieter footer
- stronger empty state
- differentiated styling for narrative, action, result, and interrupt events

### V2 Information Architecture Upgrade

Implement:

- wide-screen two-column layout
- collapsed versus expanded activity drawer
- keyboard-first history navigation
- richer status receipts for validate, sync, verify
- command output summarization rules
- compact session naming and resume status

### V3 Premium Finish

Implement:

- background-aware palette adaptation
- polished loading treatments and spinner rhythm
- help overlay and keyboard legend
- selectable verbosity profiles: calm, operational, verbose
- snapshot-friendly final summary screen for demos and screenshots

## Non-Negotiable Design Principles

- The user should never need to parse logs to know whether Yagr is healthy.
- The answer surface and the operations surface must remain visually distinct.
- A blocked run must be more visually obvious than a running run.
- The interface should look composed even when nothing is happening.
- Beauty must survive narrow terminals and weak ANSI capabilities.
- Power users must be able to reconstruct what happened without leaving the TUI.

## Immediate Recommendation

The next implementation pass should not start by adding colors everywhere.

It should start by restructuring [packages/yagr/src/gateway/interactive-ui.tsx](/home/etienne/repos/n8n-as-code/packages/yagr/src/gateway/interactive-ui.tsx) around four persistent surfaces:

1. header band
2. main stage card
3. compact timeline rail
4. composer footer

And it should explicitly preserve a fifth interaction surface reachable by shortcut:

5. integrated scrollback/history browser

Then the feed model should be upgraded from generic kinds to explicit UX lanes:

- narrative
- action
- result
- interrupt

That is the highest-leverage change for making Yagr feel like a premium agent console rather than a styled transcript.