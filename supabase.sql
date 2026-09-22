-- BETTING TERMINAL V4
-- Run this entire file in the Supabase SQL editor.
-- This keeps the first database focused: shared bets + model prediction logging.

create table if not exists public.bets (
  id text primary key,
  room_code text not null,
  bettor text not null,
  sport text not null,
  game text not null,
  bet_type text not null,
  selection text not null,
  odds integer not null,
  stake numeric(12,2) not null default 0,
  book text,
  result text not null default 'Pending',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.model_predictions (
  id text primary key,
  room_code text not null,
  game_id text,
  sport text not null,
  model_version text not null,
  selection text not null,
  model_probability numeric(7,4),
  market_odds integer,
  implied_probability numeric(7,4),
  edge numeric(7,4),
  outcome text,
  predicted_at timestamptz not null default now(),
  settled_at timestamptz
);

alter table public.bets enable row level security;
alter table public.model_predictions enable row level security;

drop policy if exists "room read" on public.bets;
drop policy if exists "room insert" on public.bets;
drop policy if exists "room update" on public.bets;
drop policy if exists "room delete" on public.bets;

create policy "room read" on public.bets for select using (true);
create policy "room insert" on public.bets for insert with check (true);
create policy "room update" on public.bets for update using (true) with check (true);
create policy "room delete" on public.bets for delete using (true);

drop policy if exists "model read" on public.model_predictions;
drop policy if exists "model insert" on public.model_predictions;
drop policy if exists "model update" on public.model_predictions;

create policy "model read" on public.model_predictions for select using (true);
create policy "model insert" on public.model_predictions for insert with check (true);
create policy "model update" on public.model_predictions for update using (true) with check (true);

-- Enable Realtime for shared updates in Supabase Dashboard:
-- Database > Replication > enable public.bets
-- Later, enable public.model_predictions when prediction logging is turned on.

-- IMPORTANT:
-- These permissive policies are appropriate only for the current shared-room MVP.
-- Add Supabase Auth + user-based RLS before storing sensitive financial information.
