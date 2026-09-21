# Family Registry

Family Registry is a family-tree / genealogy web app. Members sign in with Google, and can browse, search, and edit a shared registry of relatives — with an interactive pannable family tree, a birthday calendar, and CSV export.

## How it works

- **Sign-in**: Google OAuth (either the redirect flow or the GSI popup). There's also a legacy local username/password login left over from the project's original "API boilerplate" template.
- **Families**: A *family* is a named group (usually a last name). Each family has one or more root ancestor pairs, and the tree is built by walking down from those roots through children and spouses.
- **Visibility & permissions**: What you can see and edit is computed, not stored directly — it's derived by tracing your account's email to a person record, then walking up to find which families you're genealogically connected to, and down to find everyone visible in those families. Roles are `owner` (created the family) > explicit `editor`/`viewer` grant > implicit `editor` for anyone genealogically connected. See [CLAUDE.md](CLAUDE.md) for the exact algorithm.
- **Screens**: Search, Profile (view/edit a person), Tree (canvas-rendered pannable tree diagram), Calendar (birthdays), Browse (filter people and export a CSV — sortable by a computed depth-first family order), and Settings (manage families and sharing).

## Running it

```
npm install
node index.js       # or: npm start
```

Requires a `.env` file with `PORT`, `GOOGLE_CLIENT_SECRET`, `REDIRECT_URI`, `DB`, `DB_USER`, `DB_PASS`, `SSH_PASS`, `DB_TYPE`.

Create a local (non-Google) API user with:

```
node cli.js
```

## Deployment & backups

Pushing to `main` deploys automatically via GitHub Actions (see `.github/workflows/deploy.yml`). `backup.sh` dumps the `family_db` MySQL database and uploads it to Google Drive.

## For contributors / AI agents

See [CLAUDE.md](CLAUDE.md) for a full breakdown of the backend/frontend architecture, the data model, and the permission-resolution logic in detail.
