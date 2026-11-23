# OpsPilot: an AI operations inbox for small businesses

OpsPilot is an AI agent for small-business operations. A customer enquiry, a supplier invoice or a quote request arrives, and the agent:

1. reads it and extracts the key fields;
2. classifies it;
3. looks the sender up in the customer database;
4. writes a draft reply;
5. routes the card on a Kanban board.

Every step streams to the screen as it happens. Anything uncertain or risky lands in **Needs review** for a person, and only a person can mark work **Done**.

**Live demo:** _TBC_  ·  **Stack:** Next.js 16, TypeScript, Tailwind, Postgres (Supabase), Claude API (tool use), Vercel

> All data is synthetic. The business ("Harbour & Co", a commercial kitchen equipment supplier) and every customer are invented, and emails use the reserved `.example` domain.

---

## 1. Features: all 5 from the brief

| Brief feature | In OpsPilot | Where |
|---|---|---|
| **AI agents** (goal, tools, multi-step, visible) | A Claude tool-use loop with 5 tools. Each model thought, tool call and result is saved and shown live in the item's timeline | `src/agent/` |
| **Streaming / scheduled** | Steps and the reply text stream token by token over Server-Sent Events. A Vercel cron job processes the New column on a schedule | `api/items/[id]/run`, `api/cron/process` |
| **Saved drag and drop** | Kanban board (dnd-kit). Column and order are saved with fractional positions, one row update per move, with an optimistic UI that rolls back on error | `components/Board.tsx`, `lib/ordering.ts` |
| **CRUD** | Create, edit and delete items (including editing the AI draft) and customers | `api/items`, `api/customers`, `/customers` |
| **Analytics dashboard** | KPIs (items processed, % auto-routed, average agent time, human overrides) and 2 charts (by category, per day) computed in SQL from live rows | `lib/stats.ts`, `/dashboard` |

### Try it
1. On the board, open **"Quote for a second combi oven"** and press **Run agent**. Watch the steps and the reply stream in. It should land in *Ready to send*.
2. Run **"URGENT: update our payment details"**. It's a prompt-injection / payment-fraud attempt, and should land in *Needs review* with the reason shown.
3. Drag a card between columns, then reload: the move is saved and logged as a human override.
4. **+ New item** → paste anything → **Add & run agent**.
5. Check **Dashboard** and **Customers**. Edit a customer's notes and the agent's next reply uses them.

## 2. Architecture

```
Browser (React client components)
  Board (dnd-kit) ─ PATCH /api/items/:id {status, position}
  Item drawer ───── POST  /api/items/:id/run ──► text/event-stream
  Customers ─────── /api/customers[/:id]          (run, step, token, item, done)
  Dashboard ─────── GET   /api/stats
                         │
Next.js route handlers (Node, server only: secrets never reach the browser)
  runAgent(item) ── loop ≤ 8 turns / 50 s ──► Claude Messages API (tools)
     │   ├─ extract_fields  (record tool, zod-validated)
     │   ├─ classify        (record tool: category, priority, confidence)
     │   ├─ lookup_customer (SQL)
     │   ├─ draft_reply     (second, streamed Claude call → tokens to UI)
     │   └─ move_card       (a *request* only)
     ▼
  decideRoute() ── deterministic review policy ─► needs_review | ready
     │
Postgres (Supabase): customers · items · agent_runs · agent_steps
```

**Key design decisions**
- **The human checkpoint is code, not a prompt.** The model *asks* for a column with `move_card`, but `src/lib/policy.ts` makes the final call. It sends an item to review if confidence is below 0.75, the sender is unknown, it is a complaint, it is an invoice over $5k, there is no draft, or the run failed. A prompt can be talked out of a rule; a function cannot. The timeline shows when the policy overrode the agent. Moving a card to **Done** is human-only.
- **Record tools for structured output.** `extract_fields` and `classify` have no side effects: the tool *input* is the structured result. The JSON schemas are generated from zod schemas, and the same zod schemas validate what the model sends. Invalid input goes back to the model as an `is_error` tool result so it can correct itself, rather than crashing the run.
- **Save, then stream.** Each step is written to `agent_steps` before it is sent over SSE. A reload, or a client that disconnects mid-run, loses nothing, and the timeline is an audit log.
- **Injected dependencies.** `runAgent` takes an `AgentLLM` and an `AgentStore`, so the whole loop is unit tested with a scripted fake model and an in-memory store. There are no network or DB calls in the tests.
- **Untrusted input.** Item text is wrapped in `<item>` tags, and the system prompt tells the model to ignore instructions inside it. The policy is the backstop if it doesn't.
- **Direct Postgres, locked-down REST.** The server connects with `postgres` through Supabase's transaction pooler. Row-level security is enabled with no policies, so Supabase's public REST API can't read or write the tables.
- **Protecting a public demo.** A global per-hour cap on agent runs (`RUN_LIMIT_PER_HOUR`) plus a spend limit on the API key. Calls use low effort, and the writer can be a smaller model (`WRITER_MODEL`).

## 3. AI workflow: how this was built

This project was built AI-first, with a human directing and checking the work:
- **Spec before code.** The plan, [`SPEC.md`](SPEC.md) and [`CLAUDE.md`](CLAUDE.md) came first. They fixed the agent's goal, the tool list, the review policy, the data model and the rules an AI coding agent must follow in this repo (policy over prompt, injected side effects, save-then-stream, no secrets client-side, synthetic data only).
- **Claude wrote the code** through an agentic coding workflow (Claude Code with Claude Opus), working module by module: schema, policy, tools, the agent loop, API, UI. CI ran after each stage: lint, typecheck, tests and build.
- **Human decisions:**
  - the product concept and scope (ship all 5 features, not 3 shaky ones);
  - the stack;
  - the human-in-the-loop rules and thresholds;
  - a public repo with synthetic data;
  - what to cut.
- **Verification:**
  - 37 unit tests: policy, ordering, SSE parsing, tool validation, and the agent loop against a scripted model, including bad tool input, model failure and the time budget;
  - a run of the full agent loop, with a scripted model, against a real Postgres database;
  - screenshot review of every page;
  - `npm run eval`, which runs the *real* model over 12 labelled items and reports category accuracy, routing accuracy and **unsafe auto-routes**, i.e. items that needed a human but went to Ready. That last one is the metric that matters.

## 4. Built vs stubbed (honest status)
| Area | Status |
|---|---|
| Agent loop, tools, policy, streaming, board, CRUD, dashboard | Built and tested |
| Email ingestion | **Not built.** Items are created in the UI or seeded. Next step: a Gmail/Outlook webhook that calls `createItem` |
| Sending replies | **Not built.** "Approve & mark sent" records the decision but sends nothing |
| Auth / multi-tenant | **Not built.** Single-tenant demo, no login |
| Dashboard history | 16 historical items are **seeded** so the charts have shape; new runs add real rows |
| "Time saved" figure | An **estimate** (6 min per item), labelled as such |
| Scheduled processing | Built. On Vercel Hobby, cron runs once a day; "Process all New" runs the batch on demand |

## 5. Trade-offs and what I'd do next
- **Calibrate confidence.** The model's self-reported confidence is a weak signal. Next: grow the labelled eval set, run `npm run eval` in CI on prompt or model changes, and tune the threshold against the unsafe-route rate.
- **Retries and escalation.** On a tool error the model retries inside the run. In production, add idempotent retries with backoff for API errors, and a dead-letter column for repeated failures.
- **Per-tenant isolation.** Add auth, a `tenant_id` on every table, RLS policies per tenant, and per-tenant rate limits and token budgets.
- **Cost and latency.** Prompt caching on the system prompt and tool definitions, Haiku for classification, and batching for scheduled runs.
- **Observability.** Per-step latency and token counts are already saved. Next: tracing (OpenTelemetry) and an alert when the override rate spikes, which is the signal that the agent is drifting.

## 6. Run it locally
Requires Node 22+ and a Postgres database (a free Supabase project works).

```bash
git clone https://github.com/brentbee/opspilot && cd opspilot
npm install
cp .env.example .env.local     # set DATABASE_URL and ANTHROPIC_API_KEY
npm run db:setup               # creates tables + synthetic seed data (use -- --reset to start over)
npm run dev                    # http://localhost:3000
```
Checks: `npm run lint && npm run typecheck && npm test && npm run build`. Eval (uses API credits): `npm run eval`.

### Deploy (Vercel + Supabase)
1. Create a Supabase project. Copy the **Transaction pooler** connection string (port 6543).
2. Run `DATABASE_URL=… npm run db:setup` once.
3. Import the repo in Vercel and set the `DATABASE_URL`, `ANTHROPIC_API_KEY` and `CRON_SECRET` env vars.
