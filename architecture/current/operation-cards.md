# Operation Cards — Implemented Design

## Overview

Each agent operation (shell, file read/write, tool call, LLM thinking) is represented as
a `YagrOperationEvent` emitted by the backend and rendered as a collapsible operation card
in both the TUI and the WebUI.

## Data Model (`src/types.ts`)

```ts
export type YagrOperationStatus = 'running' | 'done' | 'error';

export type YagrOperationCategory =
  | 'file-read' | 'file-write' | 'shell' | 'web' | 'tool' | 'agent' | 'phase' | 'thinking';

export interface YagrOperationEvent {
  kind: 'operation';
  operationId: string;   // stable — same id re-emitted to patch status/body
  label: string;         // "Read src/foo.ts", "Shell: npm test", "Thinking…"
  category: YagrOperationCategory;
  status: YagrOperationStatus;
  body?: string;         // stdout, file content, thinking tokens…
  summary?: string;      // ≤ 120-char compact line
  startedAt: number;
  endedAt?: number;
  phase?: YagrRunPhase;
}
```

Events are **idempotent by `operationId`**: the same id is re-emitted when status/body
changes (running → done/error). Consumers merge by id.

## SSOT

```
backend
  src/runtime/user-visible-updates.ts  ← all label/body/summary generation
  src/gateway/langgraph-events.ts      ← emits onOperation / onThinkingDelta
       │
       ├─ TUI (interactive-ui.tsx)     → OperationCard (Ink/React)
       └─ WebUI
            src/gateway/webui.ts       → NDJSON { type: 'operation' } frames
            src/webui/store.ts         → upsertMessageOperation (merge by id)
            src/webui/app.tsx          → OperationCard HTML component
```

## Category → icon mapping

| category    | icon | example label            |
|-------------|------|--------------------------|
| `file-read` | 📄   | Read src/foo.ts          |
| `file-write`| ✏️   | Write src/bar.ts         |
| `shell`     | ⚡   | Shell: npm install       |
| `web`       | 🌐   | GET https://…            |
| `tool`      | 🔧   | call_n8n_api             |
| `agent`     | 🤖   | Agent: classify email    |
| `phase`     | 🏁   | Inspect (1/4)            |
| `thinking`  | 💭   | Thinking…                |

## Thinking tokens

Models with extended thinking (Claude 3.7 Sonnet, Qwen3…) emit reasoning deltas via
`on_chat_model_stream` in content parts distinct from the final text:

```ts
{ type: 'thinking', thinking: string }           // Anthropic
{ type: 'reasoning', reasoning_content: string } // OpenRouter/Qwen
```

`extractDeltas()` in `langgraph-events.ts` routes these to `onThinkingDelta`. The
accumulator opens a `thinking` card on the first delta, streams body updates, and closes
(status `done`) when real text starts. Respects the `showThinking` flag.

## TUI rendering (`interactive-ui.tsx`)

- `operations: Map<string, YagrOperationEvent>` state, reset on each run
- `OperationCard` Ink component: prefix icon, label, status dot, optional body
- `OperationList` shows last 6 visible operations
- Thinking cards shown only when `showThinking=true`
- Full history (`flattenOperationsToHistoryLines`) shown in Ctrl+Y scrollback

## WebUI rendering (`app.tsx`)

- `OperationCard` React component: collapsible, click header to toggle body
- Thinking cards start collapsed; others start expanded while `running`
- `operationEntries` (entries with `.category`) rendered as `<OperationList>`
- Legacy `ChatProgressEntry` (no `.category`) still rendered in the `progressTicker`
- Up to 6 most recent operation cards shown per message during streaming

## Styles (`src/webui/styles.css`)

`.operationList`, `.operationCard`, `.operationCard.running/.done/.error/.thinking`,
`.opHeader`, `.opCategoryIcon`, `.opLabel`, `.opSpinner` (CSS animation), `.opStatusIcon`,
`.opBody` (scrollable, max-height 14rem), `.opSummary`
