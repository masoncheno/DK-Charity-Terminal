# Betting Terminal V7 — Frontend-First Live Shared Sports Terminal

V7 is a **frontend-only upgrade** built directly on the working V6 terminal. The goal of this version is to improve the command center, game cards, individual game terminal, connection status, and navigation **without changing the existing database contract**.

## ZIP contents

- `index.html`
- `app.js`
- `styles.css`
- `README.md`

## Connection protection — IMPORTANT

Keep your existing working `config.js` exactly as it is. Keep your existing Supabase database/schema exactly as it is. V7 does **not** include either file and does not require SQL changes.

The frontend still reads `window.BT_CONFIG`, creates the Supabase client from the existing project URL/public key, loads shared bets, and subscribes to the existing `bets` realtime stream. V7 also separates **database connection** from **realtime status**, so a working database connection is not incorrectly shown as offline just because realtime is unavailable.

## V7 frontend upgrades

- Command Center rebuilt around the live terminal workflow.
- Sport quick filters across the command center.
- Better live/upcoming game cards with status, score, venue, market availability, and open-game action.
- Individual game terminal with Overview / Market / Stats / Weather / Bets tabs.
- Game detail header now surfaces LIVE status, date, venue, and market strip.
- Clear connection states: OFFLINE, DATABASE CONNECTED, and LIVE SYNC.
- Existing Supabase bets, snapshots, and prediction history remain connected.
- Existing ESPN public scoreboard and event-summary feeds remain the frontend data sources.
- Missing feed fields continue to display as unavailable rather than being fabricated.
- No new database tables, policies, API keys, or backend services.

## Deploy

1. Back up the currently working version.
2. Replace only `app.js`, `index.html`, `styles.css`, and `README.md`.
3. **Do not replace `config.js`.**
4. **Do not replace or rerun `supabase.sql`.**
5. Push the four V7 files to GitHub Pages.
6. Hard refresh with `Ctrl + Shift + R`.
7. The header should show `DATABASE CONNECTED` or `LIVE SYNC` when the existing Supabase connection works.

## V7 boundary

This version intentionally does not attempt to rebuild the backend, change the schema, add paid APIs, or move the project to a new architecture. Future versions should continue to upgrade the frontend first while preserving the existing connection contract.
