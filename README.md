# Betting Terminal V6 — Live Shared Sports Terminal

V6 is built directly from the working V5 foundation. It keeps the existing Supabase connection and does **not** include or replace `config.js` or `supabase.sql`.

## ZIP contents

- `index.html`
- `app.js`
- `styles.css`
- `README.md`

## Important connection rule

Keep your existing working `config.js` in the GitHub repository. The V6 app reads `window.BT_CONFIG` from that file and does not replace it. Your existing config uses the Supabase project URL and public publishable/anon key. fileciteturn0file5L6-L10

V6 does not use local storage as the shared database. Local storage is only a temporary browser cache. Shared bets continue to use Supabase, and V6 adds shared game snapshots and prediction history.

## V6 upgrades

- Keeps the V5 live ESPN scoreboard and game-terminal structure.
- Keeps shared Supabase bets and three-bettor workflow.
- Adds automatic game snapshots after refresh.
- Adds prediction logging with model version, probability, odds, implied probability and edge.
- Adds a Snapshots page for stored game-state history.
- Adds prediction-history and basic accuracy metrics.
- Uses real returned ESPN fields only; it does not fabricate missing odds or stats.
- Keeps the existing config and database connection contract unchanged.

## Database

V6 expects the additive V5 tables `game_snapshots` and `prediction_results` to exist. The supplied V5 SQL already defines those tables and their policies. fileciteturn0file4L5-L18 fileciteturn0file4L24-L38

If those tables are already installed from V5, **do not replace your existing SQL just to install this V6 front end**.

If they are not installed, run the existing additive V5 SQL once in Supabase. Do not replace your working core schema.

## Deploy

1. Back up V5.
2. Replace only `app.js`, `index.html`, `styles.css`, and `README.md`.
3. Keep the existing `config.js`.
4. Keep the existing `supabase.sql`.
5. Commit/push to GitHub.
6. Hard refresh with `Ctrl + Shift + R`.

The V5 project already identifies `config.js` as an existing file that should not be replaced. fileciteturn0file2L42-L47

## V6 model philosophy

V6 does not claim to be a trained predictive model yet. It creates the data pipeline needed to evaluate one: real game inputs → snapshots → explicit predictions → logged outcomes → calibration/backtesting later.

Missing free-feed data remains visibly missing instead of being guessed.
