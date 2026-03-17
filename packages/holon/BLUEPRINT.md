# Holon — Architecture Blueprint

> **Vision**: An autonomous agent that transforms natural language into live automations.  
> "Tell it what to automate. It builds the workflow."

---

## 0. Brand hierarchy

```
holon                               ← THIS PROJECT (agent + product layer)
│   "Tell it what to automate."
│
├── V1 backend: n8n                 ← n8n instance + n8n-as-code packages as bridge
│   Requires: n8n instance + @holon/skills + @holon/transformer + @holon/cli
│   Ships first. Proven. 537 nodes.
│
└── V2 backend: holon-engine        ← REPLACES n8n (not a complement)
    Same integrations (Slack, Sheets, Twilio...) but:
    code-first (@node/@links/>>), AI-native (LibCST), self-contained.
    holon-engine = n8n + n8n-as-code fused into one thing.
```

**holon** is the product — what users interact with.  
**holon-engine** replaces n8n — same job, AI-native architecture.  
The two are connected through an **Engine interface** so migrating from n8n → holon-engine is a config change, not a rewrite.

---

## 1. Philosophy

### 1.1 Why not n8n workflows for the agent itself?

Implementing the agent itself as a monolithic n8n workflow is a trap:

- **Static by nature**: The agent loop is a fixed sequence of nodes. Adding a reasoning step means rewiring JSON by hand.
- **No real control flow**: n8n's switch/if nodes don't give you graph cycles, backtracking, or conditional tool retry with state.
- **No type safety**: Everything is JS strings in Code Nodes. No compile-time guarantees.
- **Debugging is blind**: n8n's execution log shows node outputs, not agent reasoning traces.
- **Vendor lock-in**: The agent logic IS n8n. You can't run it headless, test it in CI, or swap the runtime.

Our agent runs as a **TypeScript program** that _uses_ an execution engine for automations — not as its own brain. Today that engine is n8n. Tomorrow it's holon-engine.

### 1.2 The Holon principle

A **holon** is something that is simultaneously a whole in itself and a part of a larger system.

Each node is a holon: self-contained (it does one thing well), but composable (it connects to others to form workflows). A workflow is itself a holon: a complete automation, but also a building block in a larger system.

Our agent doesn't reinvent tools. It doesn't write custom HTTP calls for Slack or build ad-hoc integrations. It composes existing holons (nodes) into new wholes (workflows). The agent's differentiator is that its **tool palette is the entire node ecosystem** — grounded in validated schemas.

- **V1 (n8n)**: 537 n8n nodes, typed via the ontology in `@holon/skills`. Requires n8n + a bridge layer (n8n-as-code packages).
- **V2 (holon-engine)**: Same integrations (Slack, Sheets, Twilio...) reimplemented as `@node(type="slack.message")` library nodes. Code-first, AI-native, self-contained. No n8n instance needed.

The user sees no difference between V1 and V2 — same automations, same capabilities. The difference is under the hood: holon-engine is n8n + n8n-as-code fused into a single runtime designed for AI from day one.

This is profoundly different from an approach where the agent builds everything from generic HTTP calls, ignoring that purpose-built nodes already exist.

### 1.3 Workflows are memory

Holon should stay focused on one job: **turn intent into automation**.

That means we do **not** expand V1 into a generic assistant with reminders, notes, or chat-memory features as primary product surfaces. Those are distractions unless they directly serve workflow creation, inspection, evolution, or operation.

The key insight is that **generated workflows are already durable memory**:

- A workflow is a persisted interpretation of the user's intent
- Its topology is memory of *how* the problem was solved
- Its configuration is memory of *what matters* operationally
- Its execution history is memory of *what happened over time*

So Holon does not need a separate "memory product" to be useful. The workflows themselves are executable memories.

This creates the recursive loop:

```
User intent
  → Holon generates workflow
    → workflow persists intent as executable structure
      → Holon can inspect, explain, modify, and extend that workflow later
        → the generated artifact becomes part of Holon's future context
```

In other words: Holon creates automations, and those automations become the long-term memory Holon can talk to, reason about, and evolve.

### 1.4 Separation of concerns

```
┌──────────────────────────────────────────────────────┐
│                   Gateway Layer                       │
│   (Telegram, Web UI, CLI, API)                        │
│   Simple I/O. Stateless message routing.              │
├──────────────────────────────────────────────────────┤
│                   Agent Layer                         │
│   (Reasoning, planning, tool selection)               │
│   Stateful graph. Multi-step. Interruptible.          │
├──────────────────────────────────────────────────────┤
│                   Engine Interface                     │
│   Abstract contract: listNodes, generateWorkflow,     │
│   validate, deploy, listWorkflows, manageWorkflow     │
├────────────────────────┬─────────────────────────────┤
│   N8nEngine (V1)       │   HolonEngine (V2)          │
│   Skills + Transformer │   holon-engine Python core   │
│   + CLI sync           │   + native runner            │
│   Bridge to n8n        │   Self-contained (IS the     │
│   instance             │   runtime — no n8n needed)   │
├────────────────────────┴─────────────────────────────┤
│                   Execution Runtime                    │
│   V1: n8n instance     │  V2: holon-engine runner     │
│   (external process)   │  (same integrations,         │
│                        │   AI-native architecture)    │
└──────────────────────────────────────────────────────┘
```

Each layer has a single responsibility. The agent never talks to the runtime directly — it goes through the Engine interface.

---

## 2. Agent Framework Decision

### 2.1 Landscape analysis (March 2026)

| Framework | Stars | TypeScript | Agent loops | State machine | MCP support | Maturity |
|---|---|---|---|---|---|---|
| **Vercel AI SDK** | 22.6K | Native | `ToolLoopAgent` | No (linear) | Partial | Production |
| **LangGraph JS** | 2.6K | Native | Full graph cycles | Yes (StateGraph) | Via tools | Production |
| **Mastra** | 22K | Native | Yes + workflows | `.then()/.branch()` | Native server | Growing fast |

### 2.2 Recommendation: Vercel AI SDK

**Why Vercel AI SDK over LangGraph or Mastra:**

1. **Lightweight and composable** — It's a toolkit, not a framework. It doesn't impose an architecture, agent lifecycle, or deployment model. We compose what we need.

2. **Provider-agnostic from day 1** — `model: 'anthropic/claude-sonnet-4'` or `model: 'openai/gpt-5'`. One interface, swap providers. Users aren't locked into one LLM.

3. **Structured outputs are first-class** — `Output.object({ schema: z.object({...}) })` is exactly what we need for generating validated workflow specifications.

4. **Streaming is production-grade** — Token-by-token streaming, tool call streaming, partial results. Essential for a good UX when the agent is reasoning.

5. **No baggage** — LangGraph brings the LangChain ecosystem (heavy, opinionated). Mastra brings its own server, storage, deployers, workflows engine (we already have ours). Vercel AI SDK brings... function calls. That's it.

6. **22.6K stars, 92K dependents, 704 contributors** — Battle-tested. Not going anywhere.

**What LangGraph would give us that we DON'T need:**
- StateGraph with cycles → Our agent loop is simple: reason → plan → generate → validate → deploy. A `while` loop with tool calls handles this.
- Checkpointing/persistence → We build this ourselves (simpler, in our DB schema).
- LangGraph Platform → We don't want their cloud, we're self-hosted.

**What Mastra would give us that we DON'T need:**
- Its own workflow engine → We already have n8n for that.
- Its own agent server with API routes → We have our own gateway.
- Its own RAG and memory system → We build this to our needs.
- Enterprise licensing complexity → We want clean Apache 2.0.

### 2.3 What we take from each

| From | What we adopt | How |
|---|---|---|
| **Vercel AI SDK** | `generateText`, `ToolLoopAgent`, structured outputs, streaming, provider abstraction | Direct dependency (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) |
| **LangGraph** | *The concept* of agent-as-graph with state transitions | Inspiration. We implement our own lightweight state machine for the planning/execution loop |
| **Mastra** | *The concept* of MCP server authoring | We already expose `npx n8nac skills mcp`. We keep our own implementation |
| **Existing plugin work** | *The pattern* of gateway → plugin → tool → context injection | This repo already implements that pattern. The agent layer sits between gateway and tools |

---

## 3. Architecture

### 3.1 Package structure

```
packages/holon/
├── src/
│   ├── index.ts                 # Public API exports
│   ├── agent.ts                 # Core HolonAgent class
│   ├── engine/
│   │   ├── engine.ts            # Engine interface (abstract contract)
│   │   ├── n8n-engine.ts        # V1: n8n adapter (Skills + Transformer + CLI)
│   │   └── holon-engine.ts      # V2: holon-engine adapter (stub, future)
│   ├── tools/                   # Vercel AI SDK tool definitions
│   │   ├── search-nodes.ts      # engine.searchNodes()
│   │   ├── node-info.ts         # engine.nodeInfo()
│   │   ├── search-templates.ts  # engine.searchTemplates()
│   │   ├── generate-workflow.ts # engine.generateWorkflow()
│   │   ├── validate.ts          # engine.validate()
│   │   ├── deploy.ts            # engine.deploy()
│   │   ├── list-workflows.ts    # engine.listWorkflows()
│   │   └── manage-workflow.ts   # engine.activate/deactivate/delete
│   ├── memory/
│   │   ├── conversation.ts      # Chat history (simple, in-process)
│   │   └── workflow-registry.ts # Tracks what the agent has deployed
│   └── gateway/
│       ├── telegram.ts          # Telegram Bot API adapter
│       ├── web.ts               # Simple HTTP/WebSocket gateway
│       └── types.ts             # Gateway interface (input/output contract)
├── package.json
├── tsconfig.json
└── BLUEPRINT.md                 # This file
```

### 3.2 The Engine interface

The central abstraction that makes the backend swappable:

```typescript
interface Engine {
  // Knowledge
  searchNodes(query: string): Promise<NodeSummary[]>;
  nodeInfo(type: string): Promise<NodeSchema>;
  searchTemplates(query: string): Promise<Template[]>;

  // Generation
  generateWorkflow(spec: WorkflowSpec): Promise<GeneratedWorkflow>;
  validate(workflow: GeneratedWorkflow): Promise<ValidationResult>;

  // Deployment
  deploy(workflow: GeneratedWorkflow): Promise<DeployedWorkflow>;
  listWorkflows(): Promise<DeployedWorkflow[]>;
  activateWorkflow(id: string): Promise<void>;
  deactivateWorkflow(id: string): Promise<void>;
  deleteWorkflow(id: string): Promise<void>;
}
```

### 3.2.1 V1 engine configuration

V1 should not invent a new configuration model. It should inherit the current n8n-as-code operating model:

- local workspace config in `n8nac-config.json`
- global per-host API key store
- one active backend instance per workspace at a time

```typescript
interface N8nEngineConfig {
  host: string;
  apiKey: string;
  syncFolder: string;
  projectId: string;
  projectName: string;
  instanceIdentifier?: string;
}
```

Resolution order for V1 should match the current implementation philosophy:

1. workspace-local config (`n8nac-config.json`)
2. stored API key for the configured host
3. editor settings / environment fallback when relevant

This avoids a second setup story and keeps Holon aligned with the current n8n-as-code UX.

**V1 — `N8nEngine` implements `Engine`:**
- `searchNodes` → `@holon/skills` `KnowledgeSearch`
- `nodeInfo` → `@holon/skills` `NodeSchemaProvider`
- `searchTemplates` → `@holon/skills` template index
- `generateWorkflow` → `@holon/transformer` AST → TypeScript → JSON
- `validate` → `@holon/skills` `WorkflowValidator`
- `deploy` → `@holon/cli` sync engine (POST to n8n API)

**V2 — `HolonNativeEngine` implements `Engine`:**
- `searchNodes` → holon-engine's node registry (same integrations: Slack, Sheets, Twilio...)
- `generateWorkflow` → produce `*.holon.py` files with `@node` / `@links` DSL
- `deploy` → holon-engine's native runner (no n8n instance needed)
- Same interface, same integrations, AI-native architecture. Agent code doesn't change.

### 3.3 Core agent loop

```typescript
import { generateText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { N8nEngine } from './engine/n8n-engine';

// Engine is injected — swap N8nEngine for HolonNativeEngine in V2
const engine = new N8nEngine({ skills, transformer, cli });

const result = await generateText({
  model: anthropic('claude-sonnet-4'),
  system: buildSystemPrompt(engine),  // Engine provides available nodes context
  tools: buildTools(engine),          // All tools delegate to engine interface
  maxSteps: 15,
  messages: conversation.getHistory(chatId),
});
```

The agent's reasoning loop:
1. **Understand**: Parse user intent from natural language
2. **Search**: Find relevant n8n nodes via the ontology (`searchNodes`, `nodeInfo`)
3. **Plan**: Decide which nodes to compose and how to connect them
4. **Generate**: Produce a TypeScript workflow using the Transformer
5. **Validate**: Check the workflow against n8n schemas
6. **Deploy**: Push to n8n instance and activate
7. **Confirm**: Report back to the user with what was created

### 3.4 The tools in detail

Each tool delegates to the Engine interface:

```typescript
// Example: searchNodes tool — engine-agnostic
const searchNodes = (engine: Engine) => tool({
  description: 'Search for nodes that match a capability. ' +
    'Use this to find the right node for an automation task.',
  parameters: z.object({
    query: z.string().describe('What the node should do, e.g. "send slack message"'),
  }),
  execute: async ({ query }) => {
    const results = await engine.searchNodes(query);
    return results.map(r => ({
      name: r.name,
      type: r.type,
      description: r.description,
      category: r.category,
    }));
  },
});

// Example: generateWorkflow tool — engine-agnostic
const generateWorkflow = (engine: Engine) => tool({
  description: 'Generate a validated workflow from a specification. ' +
    'Call this after you have identified the right nodes and their configuration.',
  parameters: z.object({
    name: z.string(),
    nodes: z.array(z.object({
      name: z.string(),
      type: z.string(),
      parameters: z.record(z.unknown()),
    })),
    connections: z.array(z.object({
      from: z.string(),
      to: z.string(),
    })),
  }),
  execute: async (spec) => {
    const workflow = await engine.generateWorkflow(spec);
    const validation = await engine.validate(workflow);
    return { workflow, validation };
    // V1: generates n8n JSON via Transformer
    // V2: generates *.holon.py via holon-engine DSL
  },
});
```

### 3.5 Workflow generation pipeline

```
User intent
    │
    ▼
┌─────────────────────┐
│  HolonAgent         │  "I need a Slack trigger, an IF node, and a Twilio node"
│  (AI SDK + Tools)   │
└─────────┬───────────┘
          │ WorkflowSpec (Zod schema)
          ▼
┌─────────────────────┐
│  Engine interface    │  engine.generateWorkflow(spec)
│                      │  engine.validate(workflow)
│                      │  engine.deploy(workflow)
├─────────┬───────────┤
│ V1: N8nEngine       │ V2: HolonNativeEngine
│                      │
│ Skills → search     │ Registry → search
│ Transformer → gen   │ DSL codegen → *.holon.py
│ Validator → check   │ LibCST → validate
│ CLI sync → deploy   │ Runner → deploy
└─────────────────────┘
```

The agent doesn't know which engine runs underneath. Same tools, same reasoning, different backend.

---

## 4. Gateway Layer

### 4.1 Design: Thin and pluggable

The gateway is a **thin adapter** that converts external messages to a standard format and routes them to the agent. It does NOT contain business logic.

```typescript
// Gateway contract — every adapter implements this
interface Gateway {
  /** Start listening for messages */
  start(): Promise<void>;
  /** Stop listening */
  stop(): Promise<void>;
  /** Send a message back to the user */
  reply(chatId: string, message: string): Promise<void>;
}

// Message format — all gateways normalize to this
interface InboundMessage {
  chatId: string;
  userId: string;
  text: string;
  source: 'telegram' | 'web' | 'cli' | 'api';
  metadata?: Record<string, unknown>;
}
```

### 4.2 Existing gateway pattern (and what we keep)

The existing plugin architecture in this repository follows this shape:
```
User → Chat UI → Gateway → Plugin System → Agent (LLM)
                              │
                              ├── before_prompt_build hook  (context injection)
                              ├── registerTool              (tool registration)
                              ├── registerCli               (CLI commands)
                              └── registerService           (background services)
```

What's good:
- **Plugin-based context injection** (`before_prompt_build`): The right knowledge is injected at the right time
- **Tool abstraction**: Tools are self-describing (schema + execute function)
- **Clean separation** between gateway (message transport) and plugins (capabilities)

What we take:
- The pattern of **context injection per conversation** (we load the relevant ontology subset)
- The **tool → CLI passthrough** pattern (our tools call `n8nac` commands under the hood)

What we DON'T take:
- Any dependency on a third-party plugin SDK — we use Vercel AI SDK tools natively
- Their gateway implementation — we build our own thin adapters

### 4.3 Supported gateways at launch

| Gateway | Priority | Notes |
|---|---|---|
| **CLI** | P0 | Interactive terminal. Essential for testing and power users |
| **HTTP API** | P0 | REST + SSE/WebSocket. Foundation for all web UIs |
| **Telegram** | P1 | Widest reach for consumer users |
| **Web UI** | P2 | Hosted chat widget. Separate frontend package later |

---

## 5. What makes Holon different

| Dimension | Generic workflow-native agent | Holon |
|---|---|---|
| **Brain** | n8n workflow (static, monolithic) | TypeScript program (dynamic, composable) |
| **Knowledge** | None. Claude improvises | Full node ontology (537 n8n nodes today, holon-engine nodes tomorrow) |
| **Tool creation** | `Code Node` + `helpers.httpRequest()` | Real typed nodes (Slack, Google Sheets, Twilio...) |
| **Validation** | Test after deploy, retry if fails | Validate before deploy, correct at generation time |
| **Scope** | Chat assistant + task manager + memory | Focused: text → automation. Does one thing extremely well |
| **Runtime** | Depends on an orchestration stack around n8n | V1: Node.js + n8n. V2: holon-engine (self-contained, replaces n8n entirely) |
| **Portability** | VPS-only, docker-compose | npm package. Runs anywhere Node.js runs |
| **Engine lock-in** | Hardcoded to n8n forever | Engine interface — swap backends without rewriting the agent |

---

## 6. Data model

### 6.1 Managed workflows registry

The agent tracks what it has deployed:

```typescript
interface ManagedWorkflow {
  id: string;                    // Internal ID
  engine: 'n8n' | 'holon-engine';
  runtimeWorkflowId: string;     // ID in the active backend runtime
  name: string;                  // Human-readable name
  description: string;           // What this automation does
  createdFromPrompt: string;     // The original user request
  createdAt: Date;
  updatedAt: Date;
  active: boolean;
  nodes: string[];               // Node types used (for searchability)
  workflowFile?: string;         // Local source path (.workflow.ts in V1, *.holon.py in V2)
  summary?: string;              // Short natural-language explanation
  lastRuntimeState?: 'idle' | 'running' | 'paused' | 'error';
}
```

This registry is not just inventory. It is Holon's durable working memory about what it has created for a user.

### 6.2 Workflows as conversational memory

Holon should be able to re-open a workflow as if re-opening a conversation:

```typescript
interface WorkflowMemory {
  workflowId: string;
  createdFromPrompt: string;
  lastUserIntent?: string;
  lastAgentSummary?: string;
  relatedEvents?: string[];
}
```

Examples:
- "Update the Slack alert you built last week to also send SMS"
- "Why does my daily report workflow fail on Mondays?"
- "Disable the onboarding automation you created for me"

The memory object is lightweight because the workflow artifact itself is the real memory. Holon only stores enough metadata to find it, explain it, and continue the dialogue.

### 6.3 Conversation history

Simple and in-process for V1. No need for PostgreSQL or vector search at launch.

```typescript
interface ConversationStore {
  getHistory(chatId: string, limit?: number): Message[];
  addMessage(chatId: string, message: Message): void;
  clear(chatId: string): void;
}
```

Backed by a JSON file or SQLite for persistence. No premature optimization.

### 6.4 Credential requirements as first-class workflow metadata

Credentials are the biggest practical friction point in V1.

Holon should therefore track credential requirements explicitly for every generated workflow:

```typescript
interface CredentialRequirement {
  nodeName: string;
  credentialType: string;
  displayName: string;
  required: boolean;
  status: 'missing' | 'linked' | 'unknown';
  helpUrl?: string;
}
```

When Holon creates a workflow on n8n in V1, it should return:
- the direct link to the created workflow
- the list of missing credential requirements
- the next action the user must take in n8n UI

This keeps the product focused while making the friction explicit and actionable.

### 6.5 Credential automation rollout

Credential handling should improve in staged levels instead of jumping straight to full automation.

**Level 0 — MVP**
- Deploy workflow
- Return workflow URL
- Return missing credential requirements
- User completes credential setup in n8n UI

**Level 1 — Assisted API setup**
- Holon lists existing credentials via n8n API
- Holon detects reusable credentials that already exist
- Holon suggests or auto-links matching credentials when safe

**Level 2 — Simple credential creation via API**
- API key
- bearer token
- username/password
- service-account style secrets

These are good candidates because they are deterministic and don't require browser consent flows.

**Level 3 — OAuth-aware setup**
- Deferred until UX and security model are explicit
- Likely still handed off to n8n UI in many cases

The rule is simple: Holon should automate credential flows only when doing so is safer and simpler than redirecting the user.

---

## 7. Dependencies

### New (packages/holon only)

```json
{
  "dependencies": {
    "ai": "^4.x",                       // Vercel AI SDK core
    "@ai-sdk/anthropic": "^2.x",        // Anthropic provider
    "@ai-sdk/openai": "^2.x",           // OpenAI provider (optional)
    "@holon/skills": "workspace:*",      // Ontology (V1: n8n nodes)
    "@holon/transformer": "workspace:*", // JSON ↔ TypeScript (V1)
    "@holon/cli": "workspace:*",         // Sync / deploy (V1)
    "zod": "^3.x",                       // Schema definitions
    "telegraf": "^4.x"                   // Telegram gateway (P1)
  }
}
```

Note: `@holon/*` are the new package names. During transition, the actual workspace references may still point to `@n8n-as-code/*` and `n8nac` — the rename is a separate migration step.

### NOT adding
- LangChain / LangGraph — too heavy, not needed
- Mastra — competing framework, we'd depend on their opinions
- PostgreSQL / Supabase — premature for V1
- Express / Fastify — stdlib `http` or lightweight framework sufficient
- Any vector DB — not needed for V1, add when memory becomes a feature
- holon-engine as a dependency — it's a separate project, connected via Engine interface when ready

---

## 8. Roadmap

### Phase 1 — Agent MVP (V1: n8n backend)
- [x] `packages/holon/` package scaffold
- [x] `Engine` interface + `N8nEngine` implementation
- [x] `HolonAgent` class with first Vercel AI SDK run loop
- [x] Tools: searchNodes, nodeInfo, searchTemplates, generateWorkflow, validate, deploy, list/manage workflow (engine-backed scaffold)
- [x] CLI gateway (interactive terminal scaffold)
- [x] Single-instance configuration model: one user configures one active backend instance at a time (same model as n8n-as-code today)
- [ ] After deploy, return workflow URL + explicit missing-credentials checklist
- [ ] End-to-end: "Create a workflow that sends a Slack message every morning" → deployed on n8n

### Phase 2 — Gateways + product polish
- [ ] HTTP API gateway (REST + SSE)
- [ ] Telegram gateway
- [ ] Managed workflow registry (list, update, delete deployed automations)
- [ ] Conversation history persistence
- [ ] Assisted credential linking using existing n8n API credential endpoints
- [ ] Docker one-liner: `docker run -e N8N_HOST=... -e ANTHROPIC_API_KEY=... holon`

### Phase 3 — Brand migration
- [ ] Rename GitHub repo `n8n-as-code` → `holon`
- [ ] Republish npm packages under `@holon/*` (keep `@n8n-as-code/*` as deprecated aliases)
- [ ] New README with hero GIF and consumer pitch
- [ ] `npx create-holon` — scaffold in 30 seconds
- [ ] `holon.dev` website

### Phase 4 — holon-engine replaces n8n (V2)
- [ ] `HolonNativeEngine` implementing `Engine` interface
- [ ] RPC bridge to holon-engine Python core
- [ ] Agent generates `*.holon.py` DSL files instead of n8n JSON
- [ ] holon-engine runner as execution backend (n8n no longer required)
- [ ] Library nodes covering same integrations as n8n (Slack, Sheets, Twilio...)
- [ ] Unified visual editor (React Flow from holon-engine + VS Code host)

---

## 9. Open questions

1. ~~**Branding**~~ — **Decided.** Product = **Holon** (agent layer). Engine = **holon-engine** (replaces n8n — same integrations, AI-native architecture). V1 uses n8n as backend, V2 uses holon-engine as self-contained replacement.
2. ~~**Scope control**~~ — **Decided.** Stay laser-focused on "text → automation". No generic assistant surface for now. Workflows themselves are Holon's durable memory.
3. ~~**Multi-instance**~~ — **Decided.** Single instance for the MVP. One user configures one active backend instance at a time, matching the current n8n-as-code operating model. Multi-instance can come later.
4. ~~**Credential management**~~ — **Decided.** V1 uses a hybrid approach. Holon deploys the workflow, returns a direct link to it, and shows a missing-credentials checklist. n8n's public API does support credential operations (`GET/POST/PATCH/DELETE /credentials` and schema lookup), so this friction should be reduced quickly after MVP, but not fully automated on day one because OAuth and secret-handling add security and UX complexity.
5. ~~**Engine bridge protocol (V1)**~~ — **Resolved.** Not applicable in V1 beyond the existing n8n API and current TypeScript package layer. The true engine bridge problem starts in V2, where the recommendation remains stdio JSONL RPC to talk to holon-engine.
6. ~~**Pricing/model**~~ — **Decided.** Self-hosted open source first. Cloud offer later on.

