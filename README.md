# Betting Terminal V6 — Database-First Live Terminal

V6 is built directly from the working V5 foundation.

## Important: database connection is preserved

**Do not change or replace your current `config.js`.**  
**Do not change or replace your current Supabase SQL/schema.**

V6 uses the existing Supabase connection and the existing `bets` table. The four files in this package are only:

- `README.md`
- `app.js`
- `index.html`
- `styles.css`

Your existing `config.js` stays in the repository exactly where it already works.

## What changed in V6

### 1. Database-first shared betting
- Supabase is now treated as the authoritative source for bets.
- Bets are not reported as successfully saved until Supabase accepts them.
- If the database is disconnected, the Add Bet action stops instead of silently creating a local-only bet.
- Existing Supabase Realtime syncing remains in place for the three-person room.
- The header now clearly reports **Database live** or **Database offline**.

### 2. Better V5 foundation
- Keeps the V5 Games Center and ESPN public scoreboard feed.
- Keeps game detail pages for overview, market, stats, weather and bets.
- Keeps the transparent Model Lab rather than inventing unsupported predictions.
- Keeps the existing analytics and betting history.
- Refreshes the shared bet state after successful database writes.
- Uses a V6 Realtime channel name so the live listener is separated from V5.

### 3. UI polish
- V6 branding throughout the terminal.
- Database-first status language instead of the misleading “Local fallback” label.
- Small sync/status indicators.
- Better mobile behavior for the command center, cards, tables and navigation.

## Data sources

- Scores and schedules: ESPN public scoreboard endpoints.
- Game details: ESPN public summary endpoint.
- Market data: only odds actually returned by the ESPN feed.
- Shared betting database: your existing Supabase project.
- Hosting: GitHub Pages.

V6 intentionally does **not** fabricate sportsbook lines, player statistics, injuries, weather, model probabilities, or other data when the free source does not provide them.

## Install V6

1. Back up your current V5 files.
2. Replace only:
   - `app.js`
   - `index.html`
   - `styles.css`
   - `README.md`
3. **Keep your current `config.js`.**
4. **Keep your current `supabase.sql` and existing database tables.**
5. Commit/push to GitHub.
6. Let GitHub Pages deploy.
7. Hard refresh with `Ctrl + Shift + R`.

## V6 roadmap

### Phase 1 — Current V6
- Stable shared Supabase bet ledger
- Realtime three-person synchronization
- ESPN live/upcoming/final games
- Game terminal
- Transparent Model Lab
- Analytics and bankroll tracking
- Database-first save behavior

### Phase 2 — Game Intelligence
- Historical team-form cache
- Sport-specific recent-form metrics
- Better team/player stat panels
- Injury/news fields where a free source supports them
- More complete game-by-game matchup cards

### Phase 3 — Betting Intelligence
- Automatic implied probability
- Model probability vs market probability
- EV and edge tracking
- Line/odds snapshots
- Bet correlation and parlay exposure
- Automatic game-to-bet linking

### Phase 4 — Learning Model
- Store every model prediction
- Store the result after games finish
- Backtest by sport and market
- Calibration tracking
- Separate models/features by sport
- Confidence based on sample size, not made-up certainty

### Phase 5 — Automation
- Automatic bet settlement when reliable game results are available
- Scheduled data refresh
- Historical database
- Better alerts
- Shared dashboard improvements
- PWA/mobile terminal experience

### Phase 6 — Full Terminal
The end goal is a shared sports-betting command center combining:
- live scores
- schedules
- available odds
- game stats
- team/player information
- your three-person bet ledger
- model outputs
- bankroll/ROI
- historical performance
- transparent model learning

The priority is **real data + reliable database synchronization first**, then more advanced modeling.
