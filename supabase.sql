-- BETTING TERMINAL / SUPABASE SETUP
-- Run this in Supabase SQL Editor.
-- Then enable Realtime for the "bets" table in Database > Replication.

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

alter table public.bets enable row level security;

-- SIMPLE SHARED-ROOM MVP:
-- The room code is the shared access key. Do not put sensitive financial
-- information into this app. For a private deployment, add Supabase Auth
-- and user-based RLS later.

create policy "room read" on public.bets
for select using (true);

create policy "room insert" on public.bets
for insert with check (true);

create policy "room update" on public.bets
for update using (true) with check (true);

create policy "room delete" on public.bets
for delete using (true);

-- In Supabase Dashboard:
-- Database > Replication > enable realtime for public.bets
