# Benzing MyPigeons API: Phase 0 findings

Probed on 18 Nov 2026. Benzing doesn't document this API. Everything below comes from reading the
portal's own front-end bundle (`/assets/build/app.*.js` and its lazy chunks) and making
unauthenticated, read-only GET requests at about 1 request per second.

## Summary

| Need | Source | Sign-in? | Format |
|---|---|---|---|
| Season race list (races) | `GET /api/v2/za/smartclub/48/{season}/races` | **No** | JSON |
| Season training/toss list | `GET /api/v2/za/smartclub/48/{season}/training-races` | **No** | JSON |
| Club dashboard (latest 2 races, championships, winners) | `GET /api/v2/za/smartclub/48/{season}` | **No** | JSON |
| Benzing's own competitions | `GET /api/v2/za/smartclub/48/{season}/competitions` | **No** | JSON |
| Competition standings | `GET /api/v2/za/competition/{competitionId}/results?page=N` | **No** | JSON |
| **Every arrival for a race** | `GET /za/en/results/view/r-{raceId}-t-{resultId}-{slug}/` | **No** | **HTML only** |
| Live arrivals while a race is in progress | `POST /index.php?pid=ajax_on_the_fly_results` (`action: load_arrivals`) | **Yes** | JSON |
| Race overview page `/za/en/results/{season}/r-{raceId}-{slug}/` | 302 redirect to OAuth | Yes | n/a |

**Bottom line:** everything needed for completed races (the full truck result, the 5-bird result and the
championship) is available **without signing in**. Only the **live race board** needs a Benzing session.

## 1. Season race list

`GET https://mypigeons.benzing.live/api/v2/za/smartclub/48/2026/races`

Returns `{ organisation, clubRaces[], seasons[], countries[] }`. For 2026 there are 9 races
(Matatiele 1 to Newcastle 2). Fields we use from each `clubRaces[]` entry:

| Field | Example | Our model |
|---|---|---|
| `id` | `6975` | `Race.benzingRaceId` |
| `order` | `5` | `Race.raceNumber` |
| `raceName`, `raceNameSlug` | `MooiRiver`, `mooiriver` | name, and the slug for the result URL |
| `rawDate` / `raceDate` | `2026-07-04` / `04.07.2026` | `Race.date` |
| `liberationTime` | `08:15:00` | liberation time (local SAST) |
| `numberOfFanciers`, `numberOfPigeons` | `7`, `372` | fanciers, basketed |
| `minimumDistance`, `maximumDistance` | `463.653`, `485.647` | km |
| `raceStatus` | `R` | see open question Q5 |
| `ageCategory` | `D` | old birds (`D`) or young birds (`M`) |
| `isPrivate` | `true` | **Mooi River is flagged private, yet its results are publicly readable** |
| `results[]` | see below | the calculated result sets for this race |

Each `results[]` item is one **calculated result** that Benzing produced for the race, and it carries the
`id` that appears as `t-{id}` in result URLs. QRPC currently has these result types:

| `race_result_type.type_name` | `percentage` | What the public page lists |
|---|---|---|
| `Q.R.P.C 2026` | 20 | prize list only (e.g. 74 of 265 birds at Mooi River) |
| **`Q.R.P.C  FULL POINTS 2026`** (two spaces) | **100** | **every arrival**, so this is the source for the truck result |
| `Q.R.P.C Point by Point Aus` | | inactive (`active: 0`), not present on every race |
| `QRPC longer races extra points` | | inactive, not present on every race |
| `TEST 5 birds to count` (Mooi River only) | 100 | every arrival, with Benzing's own points, **not** 5-bird points |

The adapter chooses the result whose `race_result_type.percentage == 100`, preferring the
`FULL POINTS` type. If a race has no 100 % result, it is marked "no full result available" and is **not**
scored. It must never fall back to the 20 % list, because that would quietly drop birds.

`training-races` returns the same shape. In 2026 it lists Training, Dordrecht Toss, Cala and Ugie Test Race Toss,
all with an empty `results[]`. That gives us the Race vs Training/Toss split for free, as a default that admins
can override.

## 2. Full arrivals for a race (HTML)

`GET https://mypigeons.benzing.live/za/en/results/view/r-6975-t-17084-mooiriver/`

The page is server-rendered HTML and returns **all rows on one page** (no pagination seen, up to 377 rows).
I found no JSON equivalent that works without a sign-in. Each `<tr>` in the result table has 10 `<td>` cells:

| # | Column | Example | Notes |
|---|---|---|---|
| 0 | Position | `5` | Benzing's speed rank; **equal speeds share it** (25, 25, 27) |
| 1 | Nom. | `61` | the fancier's nomination/basket number |
| 2 | Fancier | `[fancier name]` | name only; no fancier ID in the row |
| 3 | Ring | `ZA-2024-XX-105` | |
| 4 | Arrival | `14:18:37` or `(12) 10:40:28` | `(n)` = day n of the race (day 1 has no prefix) |
| 5 | Speed | `1 274,706` | m/min, space as thousands separator, comma as decimal, **3 dp** |
| 6 | Distance | `463.653` | km, **dot** as decimal |
| 7 | Loft position | `1/65` | nth bird home for this loft / **birds basketed by this loft** |
| 8 | Club | `QRPC` | |
| 9 | Points | `500` | Benzing's points for this result type (ignored) |

The page header also gives: liberation point, race number, date, liberation time, organiser, GPS,
distance range, first and last pigeon, and the time it was last recalculated.

**Basketed per fancier** = the denominator in column 7. This sums to the race total in 8 of 9 races. It
**misses fanciers who basketed birds but got none home**:

- Matatiele 2: 407 basketed, 399 accounted for, so 1 fancier sent 8 and got 0 back
- Ladysmith 2: 257 basketed, 247 accounted for, so 1 fancier sent 10 and got 0 back

We can show the gap ("1 other fancier, 8 birds, 0 returned"), but not that fancier's name, without a sign-in.

### Acceptance test check

I parsed `r-6975-t-17084` (also in `fixtures/benzing/`) and ran the 5-bird rule over it. The result matches the
spec exactly: N = 32, with Glenn 122, Wesley 115, Larry 109, Scott 104, Theuns 47, Albert 16 and Willie 15
(total 528 = 32 × 33 / 2). `t-24685` (the TEST result) has the same 265 birds in the same order.

## 3. Club dashboard

`GET /api/v2/za/smartclub/48/2026`. Its `clubRaces` lists only the **latest 2 races**, so it is not
usable for the season list. It is useful for `fancierCompetition`, `pigeonCompetition`, `winnersOfRaces`,
`seasons` (`[2026, 2025, 2024]`) and `liveBasketings`. The `liveBasketings` field could tell us that a race is basketed or live.

## 4. Competitions

`GET /api/v2/za/smartclub/48/2026/competitions` lists Benzing's own championships (for example
`3129 Q.R.P.C Club Champion 2026`). `GET /api/v2/za/competition/3129/results?page=1` returns
`{success, data:[{fancier_id, fancier_name, score, total_order, number_of_races, …}]}`.

This is **the only public source of Benzing `fancier_id`s**, which is useful for linking fancier names to
stable IDs. Benzing's championship scores themselves are not used.

## 5. Live race data (sign-in needed)

The live board ("on-the-fly results") calls `POST /index.php?pid=ajax_on_the_fly_results` with
`{action: "load_arrivals", race_id, page_number}`. Without a session this returns HTTP 500. The page route
`/za/en/results/on-the-fly/r-{id}-{slug}/by-speed/` redirects to OAuth.

### Authentication

- The site redirects to `https://oauth.benzing.live/oauth/authorize?response_type=code&client_id=1&redirect_uri=https://mypigeons.benzing.live/login/callback`
  (an OAuth 2 authorisation-code flow for Benzing's own first-party client).
- After the callback, the portal is a classic PHP app that uses a **session cookie**. The `/api/v2` calls come
  from the same origin, so they presumably use that same cookie (not verified).
- A server *could* sign in by scripting the OAuth login form with a username and password. That is fragile
  (CSRF tokens, possible captcha) and may breach Benzing's terms. A pasted session cookie is simpler,
  but it expires.
- **Not verified:** the login form fields, cookie name and lifetime, and the live response shape. To verify
  these I need a HAR file from you while you're signed in and viewing a live race. Until then the
  live board is unspecified.

## Request etiquette used

- User-Agent `QRPC-Results/0.1 (Queenstown RPC results site; read-only)`
- At most 1 request per second; GET only, except for the single unauthenticated `load_arrivals` read probe.
- Response headers: `server: nginx`, `cache-control: no-cache, private`. There is no Cloudflare or bot
  protection in front of the site, and no rate-limit headers.

## Risks

1. **HTML scraping is the main dependency.** If Benzing changes the result page markup, the parser breaks.
   The adapter must check the shape (10 cells, positions 1..n with no gaps, row count equal to the header's
   returned count) and refuse to save a snapshot that fails these checks.
2. **Equal speeds share a Benzing position.** Benzing ranks competition-style: at Mooi River, rows 25/26,
   47/48, 81/82 and 171/172 each share a position (25, 25, 27 …). Rows 81/82 are two different fanciers
   with identical 3 dp speeds. *(The first version of this doc said that Benzing separated 81/82. That was
   wrong: it came from numbering rows by index.)* The scoring engine therefore cannot use Benzing's position
   as a tiebreak. It uses the row order on the sheet (`listOrder`) until the club chooses a rule.
3. The 100 % result type depends on how the club has set things up in Benzing. If someone deletes or renames
   `FULL POINTS`, imports stop (by design).
