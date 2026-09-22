# Betting Terminal V6

V6 builds on the working V5 terminal and focuses on turning it into a real data/model foundation instead of a static dashboard.

## Keep your existing config.js

Do NOT replace the working `config.js`.

V6 accepts either:
- `https://YOURPROJECT.supabase.co`
- `https://YOURPROJECT.supabase.co/rest/v1/`

The app normalizes the second form automatically for the Supabase client.

Expected config:

```js
window.BT_CONFIG = {
  SUPABASE_URL: "https://YOURPROJECT.supabase.co/rest/v1/",
  SUPABASE_ANON_KEY: "YOUR_ANON_KEY",
  ROOM_CODE: "FRIENDS-1",
  ESPN_REFRESH_MS: 60000
};
```

## Replace these files

Replace:
- `index.html`
- `app.js`
- `styles.css`
- `README.md`

Keep:
- `config.js`

Run `supabase.sql` once in Supabase SQL Editor.

## V6 additions

- Historical game snapshot storage
- Prediction-result storage
- Model Lab with baseline probability + market comparison
- Model prediction logging
- Team-form signals from ESPN scoreboard history when available
- Standings panels
- Team/player/event information from ESPN
- Automatic score/game snapshot capture
- Better shared/live connection validation
- No fake sportsbook lines: if ESPN does not supply a market, V6 says unavailable
- Local mode is explicitly labeled rather than silently pretending to be shared
- Realtime bet ledger remains the shared source for the group

## Important data rule

V6 never fabricates current games, odds, injuries, stats, or sportsbook markets.

ESPN is used for free public sports data. Market data is displayed only when the ESPN event actually contains it.

## Model philosophy

The V6 model is intentionally transparent. It is not presented as a proven betting edge.

The model combines available:
- current score state
- home/away context
- team records
- recent form when available
- market implied probability when available

Every prediction can be logged into `prediction_results`, creating the dataset needed for later calibration/backtesting.

## V7 direction

Once V6 is stable and collecting snapshots:
- sport-specific models
- stronger recent-form features
- player availability/injury inputs
- historical backtesting
- calibration curves
- automatic bet settlement
- line-movement history
- player prop data where a free source actually exposes it
- model learning from the stored dataset
