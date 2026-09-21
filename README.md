# Betting Terminal — Free Shared Sports Betting Tracker

This is a static, GitHub-Pages-friendly sports betting terminal for three friends.

## What is included

- Shared bet ledger
- Three bettor profiles
- Bankroll / P&L / ROI calculations
- Sport and result filters
- Live/upcoming game dashboard
- ESPN public scoreboard adapter for NFL, NBA, MLB, NHL, CFB, CBB, EPL and Champions League
- Transparent American-odds implied probability calculator
- Analytics by sport
- Model workspace
- Supabase realtime adapter for shared bets
- Local fallback mode when Supabase is not configured

## Zero-dollar architecture

Frontend/hosting: GitHub Pages
Shared database: Supabase free tier
Scores/schedules: ESPN public scoreboard endpoints
Weather: intended Open-Meteo adapter
Odds: intended optional free API adapter

A completely free project cannot honestly promise unlimited sportsbook odds for every market. The app therefore keeps odds as a replaceable adapter.

## Deploy

1. Create a PUBLIC GitHub repository.
2. Upload:
   - index.html
   - styles.css
   - app.js
   - config.js
   - supabase.sql
3. In Supabase, create a free project and run `supabase.sql`.
4. Enable Realtime for `public.bets`.
5. Copy your Supabase project URL and PUBLIC anon key into `config.js`.
6. Commit.
7. GitHub: Settings > Pages > Deploy from branch > main > root.
8. Open the generated `github.io` address.

GitHub Pages is available on GitHub Free for public repositories.

## Important

Never put a Supabase service_role key or sportsbook API secret in this frontend.

The current shared-room MVP uses permissive RLS policies so the app is easy for three friends to use. If the terminal will hold meaningful financial information, add Supabase Auth and user-based RLS before expanding it.

## Next engineering upgrades

- Open-Meteo weather adapter keyed to venue coordinates
- Free odds API adapter with caching/rate-limit handling
- automated bet settlement
- closing-line value
- line movement history
- player props
- injuries
- team/player statistical warehouse
- sport-specific predictive models
- backtesting
- alerts
- bankroll limits
