# QRPC Results

Results and championship site for the Queenstown Racing Pigeon Club. It reads race data from
BENZING MyPigeons (public data, read-only, no Benzing login) and runs on **Cloudflare Pages** (free plan).

- **Members** sign in with one shared club password.
- **Admins** sign in through **Cloudflare Access**.
- **Competitions:** the 5-bird championship is the first. More competitions and point systems can be added (see below).
- **Results** are fetched only when an admin presses **Calculate results**. They are then checked as drafts and published.
- **Live board:** Benzing is polled every 5 minutes, but only while a race is active.

Docs: [`docs/benzing-api.md`](docs/benzing-api.md) (data source) · [`docs/phase-1-plan.md`](docs/phase-1-plan.md) (design decisions).

## How it fits together

| Part | Where | What |
|---|---|---|
| Site | `index.html`, `src/web/` | React + Tailwind, built by Vite into `dist/` |
| API | `functions/api/[[path]].ts` → `src/server/api.ts` | Pages Function; all `/api/*` |
| Live poller | `worker/` | Separate Worker with a Cron Trigger (`*/5 * * * *`). Pages Functions can't run on a schedule. |
| Database | `migrations/` | Cloudflare D1 (SQLite), shared by both |
| Benzing adapter | `src/server/benzingClient.ts`, `src/core/benzing/` | The **only** code that knows Benzing's formats |
| Scoring | `src/core/scoring/` | Pure engine (100 % test coverage) and the registry of point systems |

## First-time deploy (Cloudflare dashboard + Git)

1. **Create the database.** Run `npx wrangler d1 create qrpc-results` (or create it in Dashboard → Storage & Databases → D1).
   Paste its `database_id` into **both** `wrangler.toml` and `worker/wrangler.toml`, then commit.
2. **Create the tables:**
   ```bash
   npx wrangler d1 migrations apply qrpc-results --remote
   ```
3. **Pages project.** Go to Workers & Pages → Create → Pages → *Connect to Git* and choose this repo.
   - Build command: `npm run build` · Output directory: `dist`
   - The D1 binding (`DB`) comes from `wrangler.toml`.
   - Settings → Variables and secrets (Production): add a **secret** `SESSION_SECRET` (any long random string).
4. **Cloudflare Access (admin login).** Go to Zero Trust → Access → Applications → *Add* → Self-hosted.
   - Domain: `<your-project>.pages.dev`, paths **`admin`** and **`api/admin`** (one application, two paths).
   - Policy: *Allow* → Emails → your email address. Login method: one-time PIN is fine.
   - Copy the application's **Audience (AUD) tag**. In Pages variables, set `ACCESS_AUD` to it and
     `ACCESS_TEAM_DOMAIN` to `<your-team>.cloudflareaccess.com`.
   - The API also verifies the Access token itself, so admin actions stay locked even if a policy is wrong.
5. **Live poller Worker.** Go to Workers & Pages → Create → Worker → *Import a repository* → this repo, with
   **root directory `worker`**. It deploys on every push. (Or run `npm run worker:deploy` from your machine.)
   - Free plan: an account has **5 Cron Triggers**. This uses 1.
6. **Go live.** Open `https://<your-project>.pages.dev/admin`:
   1. Settings → set the **club password**, and share it with members.
   2. Overview → **Sync races**.
   3. On each race → **Calculate results** → check the draft → **Publish**.

After that, deploying is just `git push`.

## Race-day flow

- **Live board.** On race day, live polling starts automatically at liberation time (or 06:00 if Benzing has none) and
  runs for up to 48 hours. You can also force it on or off per race on the Admin → Races tab.
- **After evaluation.** When Benzing has evaluated the race, press **Calculate results** on that race. This:
  - fetches Benzing's full results sheet (the result type that lists 100 % of arrivals),
  - cross-checks it bird by bird against the live feed,
  - creates drafts for every competition and stops live polling.
- **Review and publish.** Check the drafts, then press **Publish**. Members see nothing until then.
- **Disqualifications.** Add one on the race's admin page, with a reason. A new draft is created for you to publish.

## Adding result / point systems

- **New competition using an existing system** (for example a 3-bird or 10-bird championship): Admin → Settings → *Add a competition*.
  No code needed. Drafts are created for every race that already has results.
- **New point system:** implement `ScoringSystem` in `src/core/scoring/systems.ts` and register it in `SYSTEMS`.
  Every system takes the same input (the full result ranked by speed) and returns points per bird and per fancier.
  Storage, drafts, publishing, standings, exports and the live board then work without further changes.
  It needs its own tests, and the engine must stay at 100 % coverage.

## Develop

```bash
npm install
npm test               # includes the Mooi River acceptance test
npm run coverage       # scoring engine must stay at 100 %
npm run typecheck
cp .dev.vars.example .dev.vars   # local secrets; never commit .dev.vars
npm run db:migrate:local
npm run preview        # builds and serves site + API on http://localhost:8788
```

Locally, `DEV_ADMIN_EMAIL` in `.dev.vars` stands in for Cloudflare Access. It only works on localhost, and only when Access isn't configured.

## Security notes

- No Benzing credentials are stored anywhere. Everything used is public.
- **Member password:** stored as a PBKDF2-SHA256 hash. Logins are limited to 10 failures per IP per 15 minutes. Changing the password signs everyone out.
- **Session cookies:** `HttpOnly; Secure; SameSite=Lax` and HMAC-signed.
- **Admin requests:** POSTs require same-origin plus a custom header (CSRF protection), and every admin action is recorded in the audit log.
- **Security headers:** set in `public/_headers`.
