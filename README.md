# Betting Terminal V6 — Database-First Live Terminal

V6 builds directly on the working V5 foundation.

## CRITICAL: V6 IS NOT A LOCAL APP

V6 does **not** use localStorage as a fallback for bets.

- Bets are read from Supabase.
- New bets are written to Supabase first.
- If Supabase is unavailable, V6 refuses to save the bet instead of silently storing it locally.
- The header shows `DB live` only when the Supabase Realtime channel is subscribed.
- The app uses the configured room code so the three-person group shares one database ledger.
- Game snapshots and available market/model snapshots are also written to Supabase.

This is intentional so a local browser cache can never make one person think they are looking at the shared database.

## Files

- `app.js` — V6 terminal application
- `index.html` — terminal shell
- `styles.css` — UI
- `supabase.sql` — V6 database tables/policies
- `config.example.js` — configuration template
- `README.md` — setup notes

## KEEP YOUR WORKING CONFIG.JS

Do **not** replace your existing working `config.js`.

It should look like:

```js
window.BT_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co/rest/v1/",
  SUPABASE_ANON_KEY: "YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY",
  ROOM_CODE: "FRIENDS-1",
  ESPN_REFRESH_MS: 60000
};
```

V6 automatically normalizes a URL ending in `/rest/v1/` to the Supabase project URL before creating the Supabase client. This prevents a common REST-base URL/client mismatch.

## V6 changes

### 1. Database-first connection
V5 could display a local fallback. V6 removes that behavior.

The app:
1. Loads the Supabase client.
2. Normalizes the configured Supabase URL.
3. Creates the Supabase client.
4. Reads the shared `bets` table for the configured room.
5. Opens a Supabase Realtime channel.
6. Only then loads the live ESPN games.
7. If database initialization fails, the terminal clearly shows `DATABASE REQUIRED`.

### 2. Shared live bet ledger
New bets are saved with:

- bettor
- sport
- game
- bet type
- selection
- American odds
- stake
- sportsbook
- result
- notes
- room code
- creation timestamp

No local copy is used as the source of truth.

### 3. Game history
Each refresh can write a real ESPN game snapshot to `game_snapshots`, including:

- event ID
- matchup
- status
- scores
- available odds
- weather when returned
- timestamp

### 4. Prediction history
When an actual market price is available, V6 logs the transparent baseline model's probability and market-implied probability into `prediction_results`.

The current model is intentionally simple. It is a data pipeline foundation, not a claim of guaranteed predictive accuracy.

## Supabase setup

1. Open your existing Supabase project.
2. Keep your existing `bets` table and its working policies.
3. Run `supabase.sql` in the Supabase SQL Editor.
4. Make sure Realtime is enabled for `public.bets`.
5. Keep your current `config.js`.
6. Replace the V5 `app.js`, `index.html`, `styles.css`, `supabase.sql`, and `README.md` with V6 files.
7. Push to GitHub Pages.
8. Hard refresh with `Ctrl + Shift + R`.

## Important security note

Only use the public anon/publishable key in the browser. Never put a Supabase service-role key in `config.js`.

## Free data sources

- Scores/schedules: ESPN public scoreboard endpoints
- Event details/stats: ESPN public summary endpoint
- Market data: only prices actually returned by the ESPN event feed
- Database/realtime: Supabase free tier
- Hosting: GitHub Pages

V6 does not invent sportsbook odds when the free feed does not provide them.
