# Betting Terminal V5 — Live Shared Terminal

V5 is an additive upgrade from the working V4 foundation.

## What changed

- Keeps the shared Supabase bet ledger and three-bettor setup.
- Keeps the existing `config.js`; **do not replace it**.
- Upgrades the Games Center with:
  - live/upcoming/final filters
  - team search
  - ESPN event IDs
  - venue/event information
  - event market data when ESPN actually supplies it
- Adds a game terminal with:
  - Overview
  - Market
  - Stats
  - Weather
  - Bets
- Adds a model board using transparent, available inputs instead of fabricated numbers.
- Adds additive Supabase tables for game snapshots and prediction results.
- Adds stronger responsive formatting and a more terminal-like layout.
- Keeps local fallback if Supabase is temporarily unavailable.

## Free data approach

**Scores/schedules:** ESPN public scoreboard endpoints.

**Game detail:** ESPN public summary endpoint.

**Market data:** only event odds returned by the ESPN feed. V5 does not claim unlimited free sportsbook odds. If the feed does not return odds, the UI says they are unavailable.

**Weather:** ESPN event weather when available. The next adapter can add Open-Meteo venue geocoding without changing the rest of the app.

**Database:** Supabase free tier.

**Hosting:** GitHub Pages.

## Install V5

1. Back up the current working V4 repository.
2. Replace `app.js`, `index.html`, `styles.css`, `README.md`, and optionally run the additive `supabase.sql`.
3. **Keep your current working `config.js` exactly as it is.**
4. If you run the SQL, run the whole V5 `supabase.sql` in Supabase SQL Editor.
5. Make sure Realtime remains enabled for `public.bets`.
6. Commit and let GitHub Pages deploy.
7. Hard refresh the site (`Ctrl + Shift + R`).

## Expected config.js

```js
window.BT_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co/rest/v1/",
  SUPABASE_ANON_KEY: "YOUR_PUBLIC_ANON_KEY",
  ROOM_CODE: "FRIENDS-1",
  ESPN_REFRESH_MS: 60000
};
```

If V4 is already connected, do not change these values.

## V5 build philosophy

The terminal should prefer a missing-data message over fake data. A future trained model should only learn from logged predictions and settled outcomes, with model version, sample size, calibration and backtests recorded.

## Next build

V6 can add:
- automatic prediction logging per game
- historical team-form cache
- sport-specific features
- player/team stat panels
- line movement snapshots when a free source supplies them
- calibration and backtesting dashboards
- automatic bet settlement
- PWA/mobile polish
