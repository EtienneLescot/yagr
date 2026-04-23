# UX — Natural Scroll + Collapsible Operations

## Problem with the Ctrl+Y approach

The current TUI approach uses a "historyOpen" mode (Ctrl+Y) that swipes the entire interface toward a flat text view of history. This is not the right direction:
- it's a global mode, not an interaction on an individual item
- "normal" interface only shows the last 6 operations
- user must switch mode to read what happened

Claude Code and modern tools do it differently: classic scrolling is sufficient.
Operations (command executions, thinking) are collapsed by default, and the terminal manages scrollback naturally.

## New Direction

### TUI

**Before:**
- 2 fixed panels (stage + prompt)
- Ctrl+Y toggles to a full-screen "history" mode
- Operations displayed only during active run, cut to 6

**After:**
- Past feed rendered with `<Static>` from Ink (persists in terminal scroll buffer)
- Dynamic section at bottom of screen: live operations + live text + prompt
- No global mode: user scrolls up to see history
- All operations visible (no -6 slice)
- Operations collapsed by default (title + short summary), auto-expanded if running
- Ctrl+Y and /history removed

**Static section content (scroll buffer):**
```
[14:23]  You      · "Create a workflow that sends an email every morning"
[14:23]  Result   · "Workflow deployed — https://..."
[14:25]  You      · "Add a condition if it's the weekend"
...
```

**Dynamic section content (bottom, in-place):**
```
◐  Inspect (phase)
●  Read: package.json                0.1s
●  Shell: npm install               2.3s
◐  Write: workflow.json  ← running...
  › stream live assistant text here
╭─ Prompt ──────────────
│  ◐ Writing workflow.json…
│  › _
╰──────────────────────
```

**Shortcuts kept:**
- `Ctrl+C`: quit
- `Ctrl+O`: open workflow in browser
- `Ctrl+X`: expand/collapse last finished operation (optional, future)

**Shortcuts removed:**
- `Ctrl+Y`: replaced by natural terminal scroll
- `/history`, `/toggle-history`: removed

### WebUI

**Before:**
- `operationEntries.slice(-6)`: 6 ops max visible
- Operations disappear once streaming ends
- `showProgress = streaming || failed_terminal`: not shown on final messages

**After:**
- All operations visible on every message (no limit)
- Operations collapsed by default, expand on click (already implemented via OperationCard)
- Thinking ops collapsed and visually distinct (reduced opacity)
- Persistent operations on final messages (not only during streaming)
- `showOperations = operationEntries.length > 0` (independent of streaming)

**WebUI OperationCard UX (already in place, to improve):**
```
▼  🐚  Shell: npm install                      ✓   2.3s   ▲
   stdout
   ...output...
   exit 0
```

**CSS improvements:**
- `operationCard`: softer border-radius, gap between icon and label
- Thinking card: opacity 0.6, italic label
- Running card: border pulse animation
- Body code: mono font-family, comfortable line-height
- `opBody` max-height with internal scroll if very long

## Implementation

### Files touched
- `src/gateway/interactive-ui.tsx` (TUI refactor)
- `src/webui/app.tsx` (WebUI: remove slice, showProgress, OperationCard defaults)
- `src/webui/styles.css` (improvements)

### Non-regression
- `YagrOperationEvent` type unchanged
- `feed` entries (user/result/interrupt) unchanged
- `pushEntry` unchanged
- WebUI SSE protocol unchanged
