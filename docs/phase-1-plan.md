# Phase 1 plan: architecture, data model and pages

Status: **approved 18 Nov 2026.** The points engine, the result parser and the acceptance test are built.

## Decisions so far (18 Nov 2026)

| Topic | Decision |
|---|---|
| Hosting | Cloudflare Pages, like the other sites |
| Admin sign-in | Cloudflare Access on `/admin*` and `/api/admin*`. No passwords or TOTP code in the app. |
| Member sign-in | **One shared club password.** It is stored as a Pages secret (hashed) and sets a signed, httpOnly cookie for 90 days. Changing the password logs everyone out. |
| Domain | Free Cloudflare subdomain: `<project>.pages.dev` (site), `<name>.<account>.workers.dev` (sync worker, no public routes) |
| Deploys | Git-connected: Wes pushes to `main`, Pages builds the site, Workers Builds builds the sync worker |
| Plan | **Workers Free**, for as long as it holds (see limits below) |
| Late birds | A fancier's first 5 birds home score, **however late they arrive**. There is no closing cut-off for scoring. |
| Ties | **No shared positions** for scoring birds. Benzing *does* share positions on equal speeds, so the engine breaks exact ties by the row order on Benzing's sheet **for now**. See open question T1. |
| Live board | Yes. Needs a Benzing session (see `benzing-api.md` §5). |
| 5-bird source | Built **only** from the arrivals on the full results sheet (the Benzing result type with `percentage = 100`). It ignores Benzing's points, competitions and championships completely. |

## Architecture

```
            ┌──────────────── Cloudflare ────────────────┐
 members ──►│ Pages: static React app (Vite + TS + Tailwind)│
 (phone)    │   + Pages Functions /api/*  (read + admin)   │
            │            │                                 │
 admin ──►  │  Access ───┘ (guards /admin*, /api/admin*)   │
            │            ▼                                 │
            │           D1 (SQLite)  ◄─────┐               │
            │                              │               │
            │  Worker "qrpc-sync" (Cron Trigger, 1 min) ───┼──► mypigeons.benzing.live
            └──────────────────────────────────────────────┘
```

Why the stack differs from the original brief:

- **Not Next.js.** Cloudflare has deprecated its Next.js adapter for Pages (`next-on-pages`) in favour of
  OpenNext, which runs on Workers, not Pages. On Pages, a static React app plus Pages Functions is the native
  approach, with nothing in between to break.
- **A separate Worker for polling.** Pages Functions **cannot run on a schedule**, so a small companion Worker
  with a Cron Trigger does all the Benzing calls and shares the D1 database with the site. This is also the
  single Benzing adapter the brief asks for.
- **D1 + Drizzle instead of Postgres + Prisma.** D1 is built into Pages and Workers, and Drizzle is a light,
  type-safe ORM that supports D1 directly. The data volume is tiny: about 10 races × 400 birds a season.
- **PDF export** is generated in the browser (print-ready page, or jsPDF), because headless PDF rendering in
  Workers needs Cloudflare's paid Browser Rendering.
- **Free-plan limits that matter:**
  - **10 ms CPU per invocation.** Parsing and scoring Mooi River (265 birds) takes about 2 ms median and 3.4 ms p95 in Node
    here. Expect 2–3× that on Workers, which still fits for a 400-bird race. The parser is pure regex, with no DOM library.
  - **5 Cron Triggers per account.** The sync worker needs **1**, so check how many your other sites use.
  - 100 000 requests per day across Pages Functions and Workers, and D1 at 5 M reads and 100 k writes per day: far above club traffic.
  - 50 outbound requests per invocation: each run fetches at most a few pages.
  - If any of these is ever hit, the fix is Workers Paid ($5/month), with no code changes.

### Sync worker behaviour

- Every minute it checks for work, and makes no Benzing calls when there's nothing to do.
- **Season list:** `smartclub/48/{season}/races` and `/training-races`, every 6 hours, and on demand from admin.
- **Live race:** from liberation time on race day until an admin marks the race closed, it reads live arrivals
  every 60 s (needs a Benzing session).
- **After a race:** it checks for the full (100 %) result every 15 minutes. When the result appears, or its
  "last re-calculation" time changes, it takes a new snapshot and creates a **draft** 5-bird calculation.
- **Validation before saving:** 10 cells per row, positions 1..n with no gaps, speeds never increasing down the
  list, row count = number returned, and the loft denominators add up to no more than the number basketed.
  If a check fails, nothing is saved, an alert is raised, and the last good data stays live.
- Throttled to 1 request per second, with User-Agent `QRPC-Results/1.0 (Queenstown RPC results site; read-only)`.
- A snapshot is stored only when its content hash changes, so live polling doesn't fill the database.

## Points engine (pure TypeScript, 100 % test coverage)

```
input:  arrivals[] (position, fancierKey, ring, speedMilli), settings {scoringBirds}, overrides[]
1. drop disqualified birds and fanciers (overrides)
2. sort by speedMilli desc, then benzingPosition asc
3. walk the list, keeping each fancier's first `scoringBirds` birds
4. N = number of scoring birds; scoring position p = 1..N (unique, no ties)
5. points = N − p + 1
6. fancier race score = sum of points
output: scoring lines + fancier scores + N + an inputs hash
```

Speeds are stored as integers (m/min × 1000) so floating-point rounding can never reorder birds.

The championship total is the sum of **published** race scores over the counted races (all, or best X of Y),
using the included races.

Acceptance test: `fixtures/benzing/r-6975-t-17084-mooiriver.html` → parser → engine must produce
N = 32 and Glenn 122, Wesley 115, Larry 109, Scott 104, Theuns 47, Albert 16, Willie 15. Extra unit tests
cover equal speeds, a fancier with fewer than 5 birds, zero birds, overrides, and changing `scoringBirds`.

## Data model (D1)

All tables carry `club_id` (QRPC = Benzing org 48) so multi-club support (Phase 2) needs no migration.

| Table | Key columns |
|---|---|
| `club` | id, benzing_org_id, country, name |
| `fancier` | id, club_id, name, benzing_fancier_id (nullable, linked via competitions API), active |
| `race` | id, club_id, benzing_race_id, season, number, name, slug, date, liberation_time, liberation_point, min/max_distance_m, basketed_total, fanciers_total, **kind** (race / training), **included**, status (scheduled / live / awaiting_result / complete), full_result_id, last_synced_at |
| `snapshot` | id, race_id, kind (live / final), fetched_at, source_url, content_sha256, raw (compressed text), row_count, header_json |
| `arrival` | id, snapshot_id, race_id, benzing_position, nomination, fancier_id, ring, arrival_day, arrival_time, arrived_at (UTC), speed_milli, distance_m, loft_order, loft_basketed |
| `race_entry` | race_id, fancier_id, basketed, returned (derived per snapshot) |
| `override` | id, race_id, scope (bird / fancier), fancier_id, ring, reason, actor, created_at, revoked_at |
| `settings_version` | id, scoring_birds, races_counted (all / best_x), best_x, created_at, actor. **Rows are never edited**; each change adds a new row. |
| `race_calc` | id, race_id, snapshot_id, settings_version_id, overrides_hash, inputs_hash, status (draft / published / superseded), created_at, published_at, published_by |
| `race_calc_line` | race_calc_id, arrival_id, fancier_id, scoring_position, points |
| `race_calc_score` | race_calc_id, fancier_id, birds_scored, score |
| `season_calc` | id, season, settings_version_id, race_calc_ids_json, created_at; plus `season_calc_score` (fancier_id, total, counted_race_ids) |
| `alert` | id, at, level, source, message, resolved_at |
| `audit_log` | id, at, actor (email from the Access token), action, entity, entity_id, before_json, after_json |
| `benzing_session` | encrypted cookie (AES-256-GCM; the key is a Worker secret), set_at, last_ok_at, expires_hint |

Phase 2 hooks: `arrival.ring` becomes the key for a future `pigeon` table and the ring-book link;
`race_entry` already holds basketed counts, which is where basket and truck costs will attach; and
`club_id` is already on every table.

## Pages

Members (behind the member password, phone-first):

| Route | Content |
|---|---|
| `/` | latest published race, championship top 5, next race date, a "live now" banner during a race |
| `/races` | season list (races, then training/tosses) |
| `/races/:id` | details card + tabs: **Full result** (all arrivals; basketed/returned per fancier) and **5-bird result** (scoring birds, points, fancier totals). Export: CSV, PDF, WhatsApp text. |
| `/live` | live arrivals and provisional 5-bird standings, refreshed every 60 s, clearly labelled "provisional" |
| `/championship` | season table with race-by-race points; tap a fancier to drill down |
| `/fanciers/:id` | races entered, basketed/returned, return %, scoring birds and points per race |
| `/rules` | the 5-bird system in plain English, with Glenn's Mooi River example and the tie rule |
| `/login` | password form |

Admin (behind Cloudflare Access):

| Route | Content |
|---|---|
| `/admin` | alerts, sync status, drafts awaiting publish |
| `/admin/races` | mark each race as Race or Training/Toss, include it or not, force a re-sync |
| `/admin/races/:id` | review the draft against the full result, add or revoke DQ overrides (reason required), **Publish**, recalculate |
| `/admin/settings` | scoring birds, races counted, member password rotation |
| `/admin/benzing` | paste or replace the Benzing session cookie, "Test connection", "Remove", "Connected as… / last sync" |
| `/admin/audit` | audit log |

## Open questions

- **T1 Tiebreak for exactly equal speeds between different fanciers.** This happened once at Mooi River
  (rows 81/82, both outside the scoring birds), but it will eventually decide a point. Options:
  (a) the order on Benzing's sheet (current behaviour, though we don't know how Benzing orders it),
  (b) the earlier clock time, (c) the longer distance, (d) the higher speed at more decimals (not available
  without a sign-in). Ties between two birds of the *same* fancier never change their total.
- **T2 Disqualified birds.** Currently the bird is removed before selection, so that fancier's 6th bird moves
  up into the 5, and every bird behind it gains a place. The alternative is that the bird stays in the ranking
  but scores 0. Which one does the club want?
- **T3 Championship ties.** Equal season totals currently share a rank (1, 1, 3). Should there be a tiebreak instead?
- **M4 Live board:** waiting for the HAR file and cookie names (see the chat for upload steps).
