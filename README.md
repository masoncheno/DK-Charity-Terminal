# Betting Terminal V7

V7 builds directly on the connected V6 terminal. It keeps the existing Supabase connection and database schema intact.

## ZIP contents
- `README.md`
- `app.js`
- `index.html`
- `styles.css`

## Do not replace
Keep your existing working `config.js` exactly as it is. Do not replace or rerun `supabase.sql` for V7.

## V7 upgrades
- Keeps the live shared Supabase bet ledger.
- Keeps ESPN live schedules, scores, event details and real market data when ESPN supplies it.
- Adds stronger database connection health reporting separate from Realtime status.
- Automatically settles logged home/away predictions from final ESPN scores when the prediction selection matches a team.
- Adds model accuracy and Brier-score tracking from settled predictions.
- Adds probability calibration buckets so the model can be evaluated as real prediction history accumulates.
- Keeps real-data-only behavior: missing odds/stats/weather are shown as unavailable rather than fabricated.
- Keeps game snapshots and prediction history in the existing V5/V6 tables.

## Install
1. Extract this ZIP.
2. Replace only `README.md`, `app.js`, `index.html`, and `styles.css` in GitHub.
3. Leave the existing `config.js` untouched.
4. Leave the existing Supabase SQL/schema untouched.
5. Reload GitHub Pages and use **Refresh All**.

V7 does not use a local database. LocalStorage is only a browser cache; shared bets, snapshots, and predictions use Supabase when the database connection is healthy.
