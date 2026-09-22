-- BETTING TERMINAL V5
-- Additive upgrade. Safe to run after the V4 schema.
-- Keep your existing config.js. Never expose a Supabase service-role key.

create table if not exists public.game_snapshots (
  id text primary key,
  room_code text not null,
  source text not null default 'ESPN',
  source_game_id text not null,
  sport text not null,
  matchup text not null,
  game_date timestamptz,
  status text,
  away_score text,
  home_score text,
  odds_json jsonb,
  weather_json jsonb,
  snapshot_at timestamptz not null default now()
);

create index if not exists game_snapshots_room_game_idx
  on public.game_snapshots(room_code, source_game_id, snapshot_at desc);

create table if not exists public.prediction_results (
  id text primary key,
  room_code text not null,
  prediction_id text,
  source_game_id text,
  sport text not null,
  model_version text not null,
  selection text not null,
  probability numeric(7,4),
  market_odds integer,
  implied_probability numeric(7,4),
  edge numeric(7,4),
  outcome text,
  predicted_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists prediction_results_game_idx
  on public.prediction_results(room_code, source_game_id, predicted_at desc);

alter table public.game_snapshots enable row level security;
alter table public.prediction_results enable row level security;

drop policy if exists "snapshot read" on public.game_snapshots;
drop policy if exists "snapshot insert" on public.game_snapshots;
drop policy if exists "prediction read" on public.prediction_results;
drop policy if exists "prediction insert" on public.prediction_results;
drop policy if exists "prediction update" on public.prediction_results;

create policy "snapshot read" on public.game_snapshots for select using (true);
create policy "snapshot insert" on public.game_snapshots for insert with check (true);
create policy "prediction read" on public.prediction_results for select using (true);
create policy "prediction insert" on public.prediction_results for insert with check (true);
create policy "prediction update" on public.prediction_results for update using (true) with check (true);

-- Optional: enable Realtime for these tables later in Supabase Dashboard.
-- Database > Replication > select game_snapshots / prediction_results.
