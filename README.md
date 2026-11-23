# OpsPilot: an AI operations inbox for small businesses

OpsPilot is an AI agent for small-business operations. A customer enquiry, a supplier invoice or a quote request arrives, and the agent:

1. reads it and extracts the key fields;
2. classifies it;
3. looks the sender up in the customer database;
4. writes a draft reply;
5. routes the card on a Kanban board.

Every step streams to the screen as it happens. Anything uncertain or risky lands in **Needs review** for a person, and only a person can mark work **Done**.

**Live demo:** https://opspilot-lyart.vercel.app  ·  **Stack:** Next.js 16, TypeScript, Tailwind, Postgres (Supabase), Claude API (tool use), Vercel

> All data is synthetic. The business ("Harbour & Co", a commercial kitchen equipment supplier) and every customer are invented, and emails use the reserved `.example` domain.

---

## 1. Features: all 5 from the brief

| Brief feature | In OpsPilot | Where |
|---|---|---|
| **AI agents** (goal, tools, multi-step, visible) | A Claude tool-use loop with 5 tools. Each model thought, tool call and result is saved and shown live in the item's timeline | `src/agent/` |
| **Streaming / scheduled** | Steps and the reply text stream token by token over Server-Sent Events. A Vercel cron job processes the New column on a schedule | `api/items/[id]/run`, `api/cron/process` |
| **Saved drag and drop** | Kanban board (dnd-kit). Column and order are saved with fractional positions, one row update per move, with an optimistic UI that rolls back on error | `components/Board.tsx`, `lib/ordering.ts` |
| **CRUD** | Create, edit and delete items (including editing the AI draft) and customers. Each customer's emails are listed on the Customers page. The business profile (hours, service area, brands, policies) is editable, and the assistant reads it on every run | `api/items`, `api/customers`, `/customers` |
| **Analytics dashboard** | KPIs (items processed, % auto-routed, average agent time, human overrides) and 2 charts (by category, per day) computed in SQL from live rows | `lib/stats.ts`, `/dashboard` |

### Try it
1. On the board, open **"Quote for a second combi oven"** and press **Process**. Watch the steps and the reply stream in. It should land in *Ready to send*.
2. Run **"URGENT: update our payment details"**. It's a prompt-injection / payment-fraud attempt, and should land in *Needs review* with the reason shown.
3. Drag a card between columns, then reload: the move is saved and logged as a human override.
4. **+ New item** → paste anything → **Add & process**.
   Or press **✨ Add 10 sample emails** (top right). Claude writes a fresh batch of fictional emails. Code picks the scenario mix (complaints, large invoices, fraud attempts, vague one-liners, mixed requests) and the senders, so each batch exercises different agent paths. Then press **Process all New**.
5. **Reset demo** (board header) restores the original data at any time.
6. Check **Dashboard** and **Customers**. Edit a customer's notes and the agent's next reply uses them.

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
- **The human checkpoint is code, not a prompt.** The model *asks* for a column with `move_card`, but `src/lib/policy.ts` makes the final call. It sends an item to review if any of these hold: confidence is below 0.75; an unknown sender is asking about money, or the request is unclear; the sender's address doesn't match the customer it was matched to (possible impersonation); the email mentions bank or payment details; it is a complaint; an amount over $5k appears in an invoice; there is no draft; the agent stopped early; or the run failed. The bank-details and amount checks run on the raw email text, so they hold even if the model misreads it. A prompt can be talked out of a rule; a function cannot. The timeline shows when the policy overrode the agent. Moving a card to **Done** is human-only.
- **Record tools for structured output.** `extract_fields` and `classify` have no side effects: the tool *input* is the structured result. The JSON schemas are generated from zod schemas, and the same zod schemas validate what the model sends. Invalid input goes back to the model as an `is_error` tool result so it can correct itself, rather than crashing the run.
- **Save, then stream.** Each step is written to `agent_steps` before it is sent over SSE. A reload, or a client that disconnects mid-run, loses nothing, and the timeline is an audit log.
- **Injected dependencies.** `runAgent` takes an `AgentLLM` and an `AgentStore`, so the whole loop is unit tested with a scripted fake model and an in-memory store. There are no network or DB calls in the tests.
- **Untrusted input.** Item text is wrapped in `<item>` tags, and the system prompt tells the model to ignore instructions inside it. The policy is the backstop if it doesn't.
- **Direct Postgres, locked-down REST.** The server connects with `postgres` through Supabase's transaction pooler. Row-level security is enabled with no policies, so Supabase's public REST API can't read or write the tables.
- **Protecting a public demo.** A global per-hour cap on agent runs (`RUN_LIMIT_PER_HOUR`, default 60) and on new items, a cooldown on demo reset, plus a spend limit on the API key. Calls use low effort, and the writer can be a smaller model (`WRITER_MODEL`).
- **Runs can't get stuck or double up.** A run atomically claims its item, so a double-click can't start two. Model calls have short timeouts within the function's time limit, and items left in "processing" by a killed run are recovered after 3 minutes.

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
  - 63 unit tests: policy (including impersonation, bank-detail and amount checks), ordering, SSE parsing, tool validation, prompt fencing, the business profile, the email generator, and the agent loop against a scripted model, including bad tool input, model failure, stopping early and the time budget;
  - manual end-to-end checks: the agent loop with a scripted model against a local Postgres, then live runs on the deployed app;
  - an independent AI code review before submission, whose findings were fixed (stuck runs, double runs, an impersonation gap in customer matching, abuse limits);
  - screenshot review of every page;
  - `npm run eval` (also a manual **Agent eval** GitHub Action, using the `ANTHROPIC_API_KEY` repo secret), which runs the *real* model over 12 labelled items and reports category accuracy, routing accuracy and **unsafe auto-routes**, i.e. items that needed a human but went to Ready. That last one is the metric that matters.

## 4. Built vs stubbed (honest status)
| Area | Status |
|---|---|
| Agent loop, tools, policy, streaming, board, CRUD, dashboard | Built and tested |
| Email ingestion | **Not built.** Items are created in the UI or seeded. Next step: a Gmail/Outlook webhook that calls `createItem` |
| Sending replies | **Not built.** "Approve & mark sent" records the decision but sends nothing |
| Auth / multi-tenant | **Not built.** Single-tenant demo, no login. Every visitor shares one board and one business profile, so anyone can edit them; Reset demo restores the original |
| Dashboard history | The Done column is seeded from **28 real agent runs**, captured with `scripts/capture-history.ts`: genuine model steps and drafts, with dates spread over two weeks. New runs add live rows |
| "Time saved" figure | An **estimate** (6 min per item), labelled as such |
| Scheduled processing | Built. A Vercel cron job runs once a day (the Hobby plan limit) and processes up to 3 New items. Scheduled runs show a ⏱ on the card and in the timeline, and the last run time is on the dashboard. "Process all New" runs a batch on demand |

### Tuning the human checkpoint (an example of the loop)
The first live batch sent only **4 of 31** emails to Ready. Reading the routing reasons showed three causes:
- the assistant lacked basic business facts, so it played safe;
- there was no category for service work, so bookings and warranty claims scored low;
- the unknown-sender rule blocked ordinary new-customer enquiries.

The fixes were an editable business profile fed into the prompt, a `service_request` category, and letting new senders through for enquiries, quotes and service requests only. After the fixes, **18 of 42** went to Ready. What still goes to review is what *should*: bank-detail changes, complaints, invoices over $5k, vague or mixed requests, and payments from unknown senders. Safety rules are hard-coded: the bank-details and impersonation checks live in the policy code, so editing the profile can't remove them.

These numbers come from the same synthetic scenarios the prompt was tuned on, so they show the tuning loop working, not generalised accuracy. A held-out labelled set is the next step (see below).

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
2. Import the repo in Vercel and set `ANTHROPIC_API_KEY` and `CRON_SECRET`, plus `DATABASE_URL`. If you connect Supabase through the Vercel integration, it sets `POSTGRES_URL` and the app uses that instead.
3. Deploy. The `vercel-build` script runs `db:setup` first. It creates the tables idempotently, and seeds the data only if the database is empty.
