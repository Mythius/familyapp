# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Family Registry" — a family-tree / genealogy web app. Express backend + vanilla-JS frontend (no build step, no framework). Originally an "Express Boilerplate with authentication for APIs" (see `package.json` description) that was extended into a family tree tool; some boilerplate (`mail.js`, `google/google.js`, the local username/password auth path) is unused scaffolding from that original template.

## Commands

- Run the server: `node index.js` (or `npm start`). Listens on `process.env.PORT` (default 80).
- Create a local username/password API user: `node cli.js` (interactive prompt, writes to `auth.json`).
- No test runner, linter, or build step is configured. `test.js` is a standalone manual script (not a test suite) — run it directly with `node test.js` against a running server at `http://localhost:3000`; it exercises `/auth`, `/getMyFamiliesRoots`, `/people`, `/permissions`, and `/descendants/:id`.
- DB backup: `./backup.sh` — dumps `family_db` via `mysqldump`, gzips it, and uploads to Google Drive via the `gdrive` CLI. Reads DB credentials from `.env`.
- Deploy: pushing to `main` triggers `.github/workflows/deploy.yml`, which SSHes into `msouthwick.com` and runs `update.sh` on the server (not in this repo).

## Environment (`.env`)

Loaded via `dotenv` in `index.js`/`api.js`. Required vars: `PORT`, `GOOGLE_CLIENT_SECRET`, `REDIRECT_URI`, `DB` (db host), `DB_USER`, `DB_PASS`, `SSH_PASS`, `DB_TYPE` (`"ssh"` or `"normal"`, see below).

## Architecture

### Backend (Node/Express, CommonJS)

- **`index.js`** — app entrypoint. Sets up Express, body-parser, file uploads, serves `public/` statically, and owns all auth/session endpoints: `/auth/google` + `/oauth2callback` (Google OAuth redirect flow), `/auth` (legacy local username/password login against `auth.json`), `/google-signin` (Google One Tap/GSI popup flow), and `/newuser` (admin-only local user creation). Auth/session state lives in two in-memory objects, `auth` (persisted to `auth.json`) and `sessions` (not persisted — lost on restart). A global middleware after `API.public(app)` requires `req.headers.authorization` to be a valid session token and attaches `req.session` for every route registered after it via `API.private(app)`.
- **`api.js`** — all domain/business routes, registered through two exports: `exports.public(app)` (routes reachable pre-auth, e.g. `/hello`) and `exports.private(app)` (everything requiring `req.session`, e.g. `/people`, `/descendants/:id`, family/permission endpoints). Also exports `onlogin(session)`, called by `index.js` after any successful login to look up/create the user's `security` row and preload their family IDs.
- **`db.js`** — MySQL access layer with two interchangeable backends selected by `db.setQueryMode("ssh" | "normal")`: `normalQuery` connects directly to MySQL; `sshQuery` tunnels through an SSH connection (`ssh2`) before connecting — used because the DB is only reachable from the app server itself. `exports.query` always points at whichever mode is active. Also provides CSV helpers (`queryToCSV`, `loadCSV`, `saveCSV`, `uploadCSV`) built on `csv-parse`.
- **`file.js`** — thin callback wrapper around `fs.readFile`/`writeFile`, used by `db.js`, `index.js` (for `auth.json`), and `cli.js`.
- **`mail.js`**, **`google/google.js`** — unused leftover boilerplate (Nodemailer sending, and a Google Apps Script/Drive helper with its own OAuth token flow under `google/token.json` / `google/credentials.json`). Not wired into `index.js` or `api.js`.
- **`cli.js`** — standalone interactive script for creating local (non-Google) API users in `auth.json`; not part of the running server.

### Data model (MySQL, database `family_db`)

Core tables referenced throughout `api.js`:
- `people` — one row per person: `ID`, `name`, `father_id`, `mother_id`, `spouse_id`, `family_id`, plus profile fields (gender, phone, email, address, birthday, death date, maiden name, etc). Self-referential via `father_id`/`mother_id`/`spouse_id`.
- `roots` — per-family root ancestor pair (`family_id`, `father_id`, `mother_id`); the starting point for descendant traversal.
- `owned_families` — `(email, family_id)` — families a user created/owns.
- `family_permissions` — `(email, family_id, role)` — explicit `editor`/`viewer` grants from an owner.
- `security` — one row per logged-in Google user (`email`, `role`, `logins`), created on first login by `onlogin`.

### Visibility & permission model (the core complexity in `api.js`)

A user's visible people are computed, not stored, via a chain of functions in `api.js`:
1. `getFamilyIds(email)` — finds the person row matching the user's email, then walks **up** through parents/spouses to collect ancestor IDs, then finds which `roots` rows those ancestors belong to. Combined with any `owned_families`, this is "families this user is genealogically or administratively connected to."
2. `getVisiblePeopleIds(familyIds, email)` — starting from each family's root ancestors (plus everyone in any family the user owns/has permission on), walks **down** through children and spouses (BFS) to build the full visible set. This is what powers `/people` and related endpoints.
3. `getFamilyPermissions(email)` — merges three sources into one `{family_id: role}` map: `owned_families` → `"owner"`, `family_permissions` → explicit role, and genealogical membership (from `getFamilyIds`) → implicit `"editor"`. Owner > explicit grant > implicit editor.
4. `canEditFamily`/`canEditAnyFamily`/`getEditableFamilyIds` gate all mutating routes (`POST/PUT /people/:name`, `/roots/:familyId`, permission grants) using the map from step 3, cached on `req.session.family_permissions`.

`loadFamilyIds`/`loadVisiblePeopleIds` cache their results on `req.session` (soft-refresh unless `soft=false` is passed after a mutation that could change the visible set, e.g. adding a person or creating a family).

`getDescendantsWithGenerations(personId)` (backs `/descendants/:personId`) does a separate BFS assigning generation labels (`"1"`, `"2"`, `"2.1"` for a spouse of gen 2, etc.) for tree rendering.

Note on `/people/:name` updates: MySQL error 1093 forbids `UPDATE`ing a table while `SELECT`ing from that same table directly, so relationship-field lookups (`father_name`, `mother_name`, `spouse_names`, `children_names`) are wrapped in a derived-table subquery to give MySQL a separate scope.

### Frontend (`public/`, no build step — plain `<script>` tags)

Single-page app loaded via `index.html`, which is one document containing all "screens" (`search`, `profile`, `tree`, `calendar`, `filters`, `settings`) as sibling elements toggled by adding/removing classes (`.out`/`.hidden`) — there's no client-side router beyond `history.pushState` bookkeeping.

- **`api.js`** (public) — auth/session client: holds `auth_token` (in `localStorage`), the generic `request(url, data)` fetch wrapper (adds the token as an `authorization` header, not a Bearer scheme), and both Google sign-in paths (GSI popup via `googleAuth()`/`loginGoogle()`, and the redirect flow via `googleAuthRedirect()` → `/auth/google`).
- **`main.js`** — app shell: `main()` bootstraps after login (loads `/permissions`, `/people`, family IDs), screen navigation (`goto*` functions) with manual back-button/`popstate` handling, and permission helpers (`canEditFamily`, `isOwner`) mirroring the backend logic against the `/permissions` response.
- **`input.js`** — profile screen: rendering/searching the people table, the add/edit-person forms, and a custom canvas-drag/zoom `mouse` helper class shared with `tree.js`.
- **`tree.js`** — IIFE-wrapped canvas family-tree renderer: takes `people` + backend-computed `generations` (from `/descendants/:personId`) and lays out/draws nodes, spouse/child connector lines, with pan/zoom.

Data shape gotcha: `/people` returns rows as **arrays** (CSV-style, via `db.queryToCSV`), with row `0` as the header and `row[2]` as the name column — the frontend indexes into these positionally rather than by key. `/people/:name` (singular-person detail) returns a normal keyed object instead.
