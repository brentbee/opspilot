# CLAUDE.md: working agreement for AI coding agents on OpsPilot

@AGENTS.md

Read `SPEC.md` before changing behaviour. If a change contradicts the spec, update the spec in the same commit.

## Commands
- `npm run dev`: local app on :3000 (needs `.env.local`, see `.env.example`)
- `npm run db:setup [-- --reset]`: apply `db/schema.sql` and seed synthetic data
- `npm run lint && npm run typecheck && npm test && npm run build`: what CI runs; all must pass before you commit
- `npm run eval`: run the real agent over the labelled seed items (costs API credits; ask first)

## Architecture rules
- **The policy decides, not the model.** Final routing lives in `src/lib/policy.ts` and is unit tested. Never let a tool or prompt move a card to `done`.
- **Tools are validated.** Each tool has a zod schema in `src/agent/tools.ts`; the JSON schema sent to Claude is generated from it. Tool handlers never throw. They return `{ isError: true }` so the model can recover.
- **Side effects are injected.** `runAgent` takes an `AgentLLM` and an `AgentStore`, so tests run without a network or database. Keep it that way.
- **Every step is saved before it is streamed.** The UI must be able to rebuild a run's timeline from `agent_steps` after a reload.
- **Server-only secrets.** `ANTHROPIC_API_KEY` and `DATABASE_URL` are read only in route handlers and `src/lib`/`src/agent`. Never import those modules from a `"use client"` file.
- Item text is untrusted input. It goes inside `<item>` tags, and the system prompt tells the model to ignore instructions inside it.

## Conventions
- TypeScript strict, no `any`. Route handlers validate bodies with zod (`parseBody`).
- SQL via `postgres` tagged templates only (parameterised); no string-built SQL with user input.
- Small commits with imperative messages. Add or update a test with every behaviour change.
- Data is synthetic. Use `.example` email domains; never add real names, customers or credentials.
