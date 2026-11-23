# OpsPilot spec

## Problem
Small businesses lose hours each week triaging a shared inbox: enquiries, quote requests, supplier invoices and complaints. Most items need the same handful of actions: work out what it is, find the customer, write a reply, and decide whether someone senior needs to see it.

## Goal
An AI agent that does that triage end to end on each item, **visibly**, and hands a person a ready-to-send draft. Anything risky or uncertain goes to a human.

## Users
- **Ops coordinator:** works the board, reviews and sends drafts, overrides the agent.
- **Owner/manager:** reads the dashboard: volume, auto-handled rate, overrides.

## Features (assessment mapping)
| # | Brief feature | OpsPilot |
|---|---|---|
| 1 | CRUD with saved data | Items (create, edit, delete) and customers (full CRUD) in Postgres |
| 2 | Analytics dashboard | 4 KPIs, 2 charts and a scheduled-run panel, computed by SQL from live rows |
| 3 | Saved drag and drop | Kanban (New / Needs review / Ready to send / Done); status and order saved |
| 4 | Streaming / scheduled | Agent steps and reply tokens streamed over SSE; a daily cron job processes up to 3 New items |
| 5 | AI agent | Claude tool-use loop: goal, 5 tools, multi-step, every step visible and saved |

## Agent
**Goal:** fully process one item. **Tools:**
1. `extract_fields`: record sender, company, amount, due date, reference, requested items, summary.
2. `classify`: category (enquiry, quote_request, service_request, invoice, complaint, other), priority, confidence 0–1, rationale.
3. `lookup_customer`: DB search by email, then company or name.
4. `draft_reply`: tone and key points; a writer call streams the reply text.
5. `move_card`: the agent *requests* `ready` or `needs_review`.

**Context:** the editable business profile (hours, service area, brands, policies) is added to the prompt on every run.

**Limits:** at most 8 model turns and a 60 s budget per run, with 20 s per model call. Tool input is validated; an invalid call returns an error to the model.

## Review policy (deterministic)
An item goes to **Needs review** if any of these hold; otherwise it goes to **Ready to send**:
- confidence < 0.75 or missing
- sender not a known customer, unless it is an enquiry, quote request or service request (new customers are normal)
- sender's email differs from the matched customer's email (possible impersonation)
- the email text mentions bank or payment details
- category is complaint
- invoice (or "other") amount > $5,000, from the extracted field or any dollar amount in the text
- no draft written
- the agent asked for review, or stopped before requesting a column
- the run failed

Only a person can move a card to **Done**. Every human status change is logged as a `human_override` step.

## Data model
`customers`, `items`, `agent_runs` (tokens, model, status, error), `agent_steps` (ordered, typed, JSON payload). See `db/schema.sql`.

## Non-goals (for this version)
Auth and multi-tenancy, real email ingestion, sending email, attachments/OCR.
