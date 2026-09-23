# Betting Terminal V8 — Individual Game Terminal

V8 is a **frontend-only upgrade** built on the V7 foundation. The main experience is now the individual game terminal.

## Critical connection rule

**Do not replace, recreate, or modify the existing Supabase connection.**

V8 does not change `config.js`, `supabase.sql`, Supabase tables, policies, keys, URLs, or database infrastructure. It continues using the existing `window.BT_CONFIG` and Supabase client already supplied by the deployment.

## V8 game terminal

Click any game in Games Center to open a full terminal with:

- Overview — scoreboard, status, venue, broadcast, market snapshot
- Market — returned moneyline/spread/total data and implied probabilities
- Stats — event/team statistics returned by ESPN
- Injuries / News — only information actually returned by the event feed
- Weather — event weather when supplied
- Model — baseline probabilities, implied probabilities, edge, factors and data-quality notes
- Bets — group bets attached to the game

Missing information is displayed as unavailable rather than fabricated.

## Files

The V8 ZIP contains exactly four frontend files:

- `index.html`
- `app.js`
- `styles.css`
- `README.md`

Keep your existing `config.js` and `supabase.sql` in GitHub. Replace only the four files above.

## Data sources

- Scores/schedules: ESPN public scoreboard endpoints
- Event details: ESPN summary endpoint
- Market data: only when the event feed returns it
- Shared bet/history storage: existing Supabase infrastructure

## Important

The model shown in V8 is still the transparent baseline from the existing application. It is **not** presented as a trained predictive model. Later versions can improve the model without changing the game-terminal architecture or database connection.
