-- Supabase / Postgres schema for the migration result store (production backend).
--
-- Apply once per project: Supabase Dashboard → SQL Editor → paste & run, or
--   psql "$SUPABASE_DB_URL" -f supabase/schema.sql
--
-- Mirrors the local SQLite dev schema (docs/13 §5): a jsonb `payload` holding the
-- full MigrationResult, plus denormalized summary columns so the /history listing
-- never has to read the blob. `created_at` defaults to now() and is never written
-- by the app, so it always reflects when a run began (even after it completes).

create table if not exists public.migrations (
  id               text primary key,
  har_filename     text             not null,
  process_count    integer          not null default 0,
  connection_count integer          not null default 0,
  flag_count       integer          not null default 0,
  total_cost_usd   double precision not null default 0,
  created_at       timestamptz      not null default now(),
  status           text             not null default 'complete'
                     check (status in ('running', 'complete')),
  payload          jsonb
);

create index if not exists migrations_created_at_idx
  on public.migrations (created_at desc);

-- The app connects with the service-role key (server-side only), which bypasses
-- Row Level Security. Enabling RLS with no public policies keeps the table
-- locked down to that key — recommended for this internal tool.
alter table public.migrations enable row level security;
