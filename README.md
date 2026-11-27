# DailyKart POS

## Database (Supabase)

| File | When to use it |
|---|---|
| `supabase/schema.sql` | Build the whole database on a **new, empty** Supabase project. One file, run once in SQL Editor. |
| `supabase/migrations/2026*.sql` | Updates for an **existing** database, in date order. Each is safe to run more than once and only adds things. |
| `supabase/legacy-migrations/` | Old Lovable migrations, kept for history only. They cannot rebuild the database; don't run them. |
| `supabase/functions/admin-users` | Edge Function that lets admins create, edit and remove staff logins. |

When a change needs the database, add a new dated file in `supabase/migrations/` **and** the same change to `supabase/schema.sql`, so a fresh setup always matches the live one. App code should keep working if the new SQL has not been run yet.

### Backups

`.github/workflows/db-backup.yml` makes an encrypted backup every night at 03:00 IST and keeps it for 30 days under the repository's Actions tab. It stays off until two repository secrets are added: `SUPABASE_DB_URL` (Supabase > Connect > Session pooler string, with the database password) and `BACKUP_PASSPHRASE` (keep it safe; you need it to open a backup). You can also run it any time from Actions > Database backup > Run workflow.

To open a backup: `gpg --decrypt dailykart-YYYY-MM-DD.sql.gz.gpg | gunzip > backup.sql`. It holds the tables and data of the `public` schema (logins live in Supabase Auth and are not included). Restoring overwrites data, so test it on a spare Supabase project first.

---

## Lovable project

## Project info

**URL**: https://lovable.dev/projects/087cde25-b554-4e92-bde2-e01ebb626cd9

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/087cde25-b554-4e92-bde2-e01ebb626cd9) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/087cde25-b554-4e92-bde2-e01ebb626cd9) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/tips-tricks/custom-domain#step-by-step-guide)
