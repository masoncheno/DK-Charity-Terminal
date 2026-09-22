# Betting Terminal V6 — Market Intelligence

## Replace these files
- `index.html`
- `app.js`
- `styles.css`
- `README.md`

## KEEP these from your working project
- `config.js` — **do not replace**
- `supabase.sql` — **do not replace**

### V5 Local Mode fix
V6 loads the Supabase SDK first, then your existing `config.js`, then `app.js`. It accepts the common config names used by the previous working build: `APP_CONFIG`, `CONFIG`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and related aliases. It directly tests the existing `bets` table before declaring the shared database connected. It does **not** silently create a local-only betting mode.

If the existing config is unavailable, V6 displays a database error rather than falsely claiming that local data is shared.

## V6 features
- Live ESPN scoreboard feeds for NFL, NBA, MLB, NHL, college football, college basketball, EPL and Champions League.
- Date navigation.
- DraftKings-style game intelligence drawer.
- Available moneylines and totals.
- Implied probability and transparent baseline model edge.
- Available player leader information.
- League standings.
- Existing Supabase shared betting ledger and realtime refresh.
- No fake games, fake odds, or fabricated statistics.
- GitHub Pages compatible and no paid backend required by the front end.

The browser client follows Supabase's documented `@supabase/supabase-js` initialization pattern. Keep your existing working credentials/configuration.
