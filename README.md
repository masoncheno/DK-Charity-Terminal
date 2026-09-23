# Betting Terminal V7.1 — Database Permission-Safe Patch

V7.1 keeps the existing Supabase project, existing `config.js`, and existing database schema unchanged.

## IMPORTANT

Do **not** replace `config.js`.

Do **not** replace or rerun `supabase.sql`.

This build does not attempt to bypass Supabase Row Level Security. The browser must use the existing public anon/publishable key and the `bets` table must permit that key through its existing policies.

## What V7.1 fixes

- Separates Supabase URL/client connectivity from actual `bets` table database access.
- Detects `permission denied`, RLS, and PostgreSQL `42501` errors clearly.
- Does not pretend a bet was saved locally when the shared database rejected it.
- Only adds a bet to the visible shared ledger after Supabase confirms the insert.
- Keeps Realtime status independent from database read/write status.
- Adds a Database Permission Diagnostic / Test Database button in Settings.
- Keeps the existing ESPN live-game feed and V7 model/prediction features.

## Your current error

If Settings reports `permission denied for table bets`, the Supabase project is reachable but the existing `bets` table policies/grants are rejecting the browser's public key. V7.1 will identify that cleanly, but no browser-only JavaScript can safely override Supabase RLS.

The correct fix, if the error remains, is to repair the existing `bets` table RLS policies in Supabase. This ZIP intentionally does not change the database.

## Install

Replace only:

- `app.js`
- `index.html`
- `styles.css`
- `README.md`

Keep your existing `config.js` exactly as-is.
