-- OpsPilot schema. Idempotent: safe to run more than once.
-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company     text,
  email       text unique,
  tier        text not null default 'standard' check (tier in ('standard', 'priority')),
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists items (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null,
  body         text not null,
  from_name    text,
  from_email   text,
  status       text not null default 'new'
               check (status in ('new', 'processing', 'needs_review', 'ready', 'done')),
  position     double precision not null default 0,
  category     text,
  priority     text check (priority in ('low', 'normal', 'high', 'urgent')),
  confidence   real,
  extracted    jsonb,
  customer_id  uuid references customers(id) on delete set null,
  draft_reply  text,
  route_reason text,
  agent_ms     integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists items_status_position on items (status, position);

-- Category list as a named constraint, re-created on every setup so new categories migrate cleanly.
alter table items drop constraint if exists items_category_check;
alter table items add constraint items_category_check
  check (category in ('enquiry', 'quote_request', 'service_request', 'invoice', 'complaint', 'other'));

create table if not exists agent_runs (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references items(id) on delete cascade,
  trigger       text not null default 'manual' check (trigger in ('manual', 'scheduled')),
  status        text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  error         text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create index if not exists agent_runs_item on agent_runs (item_id, started_at desc);

-- Editable app settings (e.g. the business profile), stored as JSON.
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Every visible step of a run, plus human overrides (run_id null, item_id set).
create table if not exists agent_steps (
  id         bigint generated always as identity primary key,
  run_id     uuid references agent_runs(id) on delete cascade,
  item_id    uuid not null references items(id) on delete cascade,
  seq        integer not null,
  kind       text not null check (kind in ('thought', 'tool_call', 'tool_result', 'draft', 'route', 'error', 'human_override')),
  tool       text,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists agent_steps_item on agent_steps (item_id, id);

-- The app talks to Postgres directly (server-side only), never through Supabase's
-- public REST API. Enabling RLS with no policies locks that API out entirely;
-- the table owner used by the app's connection string is unaffected.
alter table customers   enable row level security;
alter table items       enable row level security;
alter table agent_runs  enable row level security;
alter table agent_steps enable row level security;
alter table settings    enable row level security;
