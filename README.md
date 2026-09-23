# Betting Terminal V7

V7 starts from the connected V6 build and focuses on the real product while preserving the existing Supabase setup.

## Files in this update
- `README.md`
- `app.js`
- `index.html`
- `styles.css`

Keep your existing `config.js` exactly as it is. Do not replace the existing Supabase database or `supabase.sql`.

## V7 database handling
V7 separates three states:
- Supabase URL configured
- Database read/write access
- Realtime subscription

Realtime being connected does not automatically mean the browser has permission to read or write `public.bets`. If Supabase returns an RLS/permission error, V7 displays that separately instead of falsely reporting the database as connected.

V7 also prevents a failed database write from being presented as a successfully saved shared bet.

## Deploy
Replace only the four files in this ZIP in the existing GitHub Pages repository. Keep `config.js` unchanged.

If Settings reports `permission denied for table bets`, the existing Supabase RLS policies on `public.bets` need to allow the anon/publishable role to read and write the shared room. The frontend cannot safely bypass Supabase RLS.
