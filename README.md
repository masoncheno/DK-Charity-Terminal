# Betting Terminal V5 — Game Intelligence

This version deliberately starts with a small, reliable vertical slice instead of trying to build every phase at once.

## What works now

### V5 — Game Intelligence
- DraftKings-style matchup/game page with a real game header and tabbed navigation
- Team statistics when exposed by ESPN
- Recent games for both teams when exposed by ESPN
- Current standings for the league when exposed by ESPN
- Home/away context and scoring averages when available
- Player leaders and player/roster information when available
- Real game-specific ESPN summary data loaded when a matchup is opened
- Detail data is cached in-browser for faster revisits


- Real ESPN public scoreboard data for NFL, NBA, MLB, NHL, CFB, CBB, EPL and Champions League
- Automatic game refresh
- Games Center with search/filter
- Click any game to open a game-specific page
- Bet-this-game flow
- Shared Supabase bet ledger
- Local fallback when Supabase is not configured
- Three bettor profiles
- P/L, ROI, record, pending exposure
- Transparent American-odds math
- Model Lab foundation
- Model prediction database table for future learning/backtesting
- Dark terminal UI

## What is intentionally NOT faked

The free browser app does not invent sportsbook odds, player statistics, injuries, weather, or model edges.

Those are separate adapters. The next build should add them one at a time and cache/log their data.

## Free architecture

- Hosting: GitHub Pages
- Database/realtime: Supabase free tier
- Scores/schedules: ESPN public scoreboard endpoints
- Weather: Open-Meteo in the next adapter
- Odds: replaceable adapter; truly free unlimited sportsbook odds are not something the browser can honestly guarantee

## Install

1. Create a GitHub repository.
2. Upload `index.html`, `styles.css`, `app.js`, `config.js`, and `supabase.sql`.
3. Create a free Supabase project.
4. Run `supabase.sql` in the SQL Editor.
5. Enable Realtime for `public.bets`.
6. Put the Supabase URL and public anon key in `config.js`.
7. Enable GitHub Pages from the repository's main branch/root.

## Build order from here

1. Game detail data tabs
2. Free weather adapter
3. Odds adapter + caching
4. Team/player statistical warehouse
5. Prediction logging
6. Sport-specific predictive models
7. Backtesting/calibration
8. Automatic settlement and alerts
9. Auth/RLS hardening
10. PWA/mobile polish

The model should learn from logged predictions and outcomes with explicit model versions. It should never silently rewrite itself from a small number of bets.
