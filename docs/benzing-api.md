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
| **Live arrivals** (also the arrivals of completed races) | `GET /api/v2/za/club-races/{raceId}/on-the-fly/arrivals?page_number=N&limit=100` | **No** | JSON |
| Race overview page `/za/en/results/{season}/r-{raceId}-{slug}/` | 302 redirect to OAuth | Yes | n/a |

**Bottom line:** everything, **including the live board**, is available **without signing in**. The app stores
no Benzing credentials. (Confirmed from Wes's HAR file on 18 Nov 2026, then repeated without a sign-in.)

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

## 5. Live arrivals (JSON, public)

Found in Wes's HAR file of the signed-in on-the-fly page, then confirmed to return the same data **without a sign-in**:

`GET /api/v2/za/club-races/6975/on-the-fly/arrivals?page_number=1&limit=100&show_reported=1`

- `limit` must be at most 100 (HTTP 422 above that). `page_number` starts at 1. A 400-bird race takes 4 calls.
- The browser also sends `authorized-user: 1`, `instance-id`, `language-code: en` and `X-Requested-With`.
  None of these are needed for the public call.
- Response: `{ arrivals[], page_count, arrival_count, race_status, is_admin, connected_fancier_ids, … }`
- Each arrival: `arrival_id`, `pigeon_id`, **`fancier_id`**, `fancier_name`, `pigeon_string` (ring),
  `sex` (`A`/`H`), **`rank_to_display` (unique, no shared ranks)**, `nomination`, `speed` (string, 3 dp),
  `distance` (float km), `time_of_arrival`, `day_of_arrival`, `data_type` (`L` = live clocking),
  `loft_position`, `basketed_pigeons`, `clock_deviation_*`, `source`.

**Cross-check, all 9 races of 2026:** the live arrival count equals the full result sheet's row count in every
race. For Mooi River, every ring, speed, distance, arrival day and time, and basketed count is identical. The
only difference is ranking: the sheet shares ranks on equal speeds, while live ranks are unique and in the same row order.

Use: the **live board and provisional standings** come from this endpoint. **Published 5-bird results** still
come from the full result sheet, as Wes asked. On every final import the two are compared, and any difference
raises an admin alert instead of publishing. The live feed is raw clockings, so a bird Benzing removes during
evaluation would appear in the live feed but not on the sheet.

Also seen in the HAR (POST, read-only actions, **need a sign-in**, so we don't use them):
`index.php?pid=ajax_race` with `get_race_panel_data` (status text such as "Being evaluated", liberation
coordinates, race duration) and `get_race_panel_connected_races`.

### Authentication (for the record; not needed)

The site uses OAuth (`oauth.benzing.live`, client_id 1) and then cookies: `PHPSESSID`, `access_token`,
`refresh_token` and `remember_web_*`. Its JavaScript refreshes tokens through `index.php?pid=ajax_refresh_tokens`
and sends `Authorization: Bearer <access_token>` on retries.

**Unknown until a live race:** which `race_status` values mean "basketed / in flight / evaluated". The values seen so far are
`R` on the 9 evaluated races, and `H` and `S` on trainings. The sync worker therefore doesn't rely on status. It polls live from
liberation time on race day until an admin closes the race (or 24 h pass with no new arrival).

## Request etiquette used

- User-Agent `QRPC-Results/0.1 (Queenstown RPC results site; read-only)`
- At most 1 request per second; GET only, except for two unauthenticated read-only POST probes (both refused).
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
