# DailyKart: backup and restore

Bills, stock, khata and accounts all live in the Supabase database. This is how to keep a copy and how to bring it back.
The restore steps below were tested on a copy of the DailyKart database (every table came back with the same row count,
the stock ledger check stayed clean, and the app's functions ran on the restored copy).

## 1. What Supabase already keeps

Open the Supabase dashboard → project **gmnrcxnwgwsoseonhbhz** → **Database → Backups**.
Paid plans keep daily backups you can restore from there with one click. The free plan doesn't give you a backup
you can download, so take your own copy (step 2) at least once a week, and always before running a database update.

## 2. Take your own copy (about 2 minutes)

You need the Supabase CLI (`npm i -g supabase`, or `npx supabase`) and the database connection string from
**Project Settings → Database → Connection string → Session pooler** (it contains the database password).

```bash
export DB_URL="postgresql://postgres.gmnrcxnwgwsoseonhbhz:<password>@<host>:5432/postgres"
D=dailykart-backup-$(date +%Y-%m-%d); mkdir $D && cd $D
supabase db dump --db-url "$DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$DB_URL" -f schema.sql
supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only
```

Keep the folder somewhere off the shop computer (Google Drive, a pen drive at home). It holds customer phone numbers
and staff salaries, so don't share it.

## 3. Restore into a new, empty Supabase project

Use this when the old project is lost or broken. Restoring over a project that still has data will fail or mix data,
so always restore into a new project.

1. Create a new Supabase project (region Mumbai). Copy its Session pooler connection string as `NEW_DB_URL`.
2. Load everything in one go. If any step fails, nothing is changed:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "$NEW_DB_URL"
   ```
   `session_replication_role = replica` stops the app's triggers from running again while old rows are loaded
   (otherwise stock would be counted twice).
3. In the new project: **Authentication → Providers → Email**, turn off "Allow new users to sign up";
   **Authentication → Multi-factor**, turn on TOTP if staff use two-step login.
4. Deploy the admin function again: `supabase functions deploy admin-users --project-ref <new ref>`.
5. In Vercel → project **daily-kart-pos** → Settings → Environment variables, set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` to the new project's values, then redeploy.
6. Check: sign in, open Reports for last month and compare the total with what you remember; open Stock and confirm
   "stock ledger" shows no mismatch.

## 4. Starting fresh without old data

`supabase/schema.sql` builds the full, current database on an empty project (SQL editor → paste → Run).
It is the same as running every file in `supabase/migrations/` in order.
