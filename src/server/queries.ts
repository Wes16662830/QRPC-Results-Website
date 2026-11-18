/** Read models for the site. Members only ever see PUBLISHED 5-bird results. */
import { calculateSeason } from "../core/scoring/fiveBird";
import { CLUB_ID, type D1Database } from "./env";
import {
  currentSettings, getRace, isLiveActive, sastDate, scoreSnapshot,
  type CalcRow, type RaceRow, type StoredArrival, type StoredCalcResult,
} from "./services";

export type RaceState = "upcoming" | "live" | "awaiting" | "draft" | "published";

async function fancierNames(db: D1Database): Promise<Map<string, string>> {
  const rows = await db.prepare("SELECT id, name FROM fancier WHERE club_id = ?").bind(CLUB_ID).all<{ id: number; name: string }>();
  return new Map(rows.results.map((r) => [String(r.id), r.name]));
}

function raceSummary(r: RaceRow, state: RaceState) {
  return {
    id: r.id,
    benzingRaceId: r.benzing_race_id,
    season: r.season,
    number: r.race_number,
    name: r.name,
    date: r.race_date,
    liberationTime: r.liberation_time_local,
    minDistanceKm: r.min_distance_m === null ? null : r.min_distance_m / 1000,
    maxDistanceKm: r.max_distance_m === null ? null : r.max_distance_m / 1000,
    basketed: r.basketed_total,
    fanciers: r.fanciers_total,
    kind: r.kind,
    included: r.included === 1,
    liveMode: r.live_mode,
    state,
  };
}

async function raceStates(db: D1Database, now: Date): Promise<Map<number, RaceState>> {
  const rows = await db
    .prepare(
      `SELECT r.*,
        EXISTS (SELECT 1 FROM race_calc c WHERE c.race_id = r.id AND c.status = 'published') AS has_published,
        EXISTS (SELECT 1 FROM race_calc c WHERE c.race_id = r.id AND c.status = 'draft') AS has_draft
       FROM race r WHERE r.club_id = ?`,
    )
    .bind(CLUB_ID)
    .all<RaceRow & { has_published: number; has_draft: number }>();
  const today = sastDate(now);
  return new Map(
    rows.results.map((r) => [
      r.id,
      r.has_published ? "published" : r.has_draft ? "draft" : isLiveActive(r, now) ? "live" : r.race_date > today ? "upcoming" : "awaiting",
    ]),
  );
}

export async function seasons(db: D1Database): Promise<number[]> {
  const rows = await db.prepare("SELECT DISTINCT season FROM race WHERE club_id = ? ORDER BY season DESC").bind(CLUB_ID).all<{ season: number }>();
  return rows.results.map((r) => r.season);
}

export async function defaultSeason(db: D1Database, now: Date): Promise<number> {
  return (await seasons(db))[0] ?? now.getUTCFullYear();
}

export async function listRaces(db: D1Database, season: number, now: Date) {
  const rows = await db.prepare("SELECT * FROM race WHERE club_id = ? AND season = ? ORDER BY race_date, race_number").bind(CLUB_ID, season).all<RaceRow>();
  const states = await raceStates(db, now);
  return rows.results.map((r) => raceSummary(r, states.get(r.id)!));
}

function decorateCalc(calc: StoredCalcResult, names: Map<string, string>, arrivals: StoredArrival[]) {
  const byOrder = new Map(arrivals.map((a) => [String(a.listOrder), a]));
  return {
    n: calc.n,
    warnings: calc.warnings ?? [],
    lines: calc.lines.map((l) => {
      const a = byOrder.get(l.arrivalId);
      return {
        scoringPosition: l.scoringPosition,
        points: l.points,
        fancierId: l.fancierKey,
        fancierName: names.get(l.fancierKey) ?? l.fancierKey.replace(/^name:/, ""),
        ring: l.ring,
        benzingPosition: l.benzingPosition,
        speed: l.speedMilli / 1000,
        arrivalDay: a?.arrivalDay ?? 1,
        arrivalTime: a?.arrivalTime ?? "",
        distanceKm: a ? a.distanceM / 1000 : null,
      };
    }),
    fanciers: calc.fanciers.map((f, i, all) => ({
      rank: i > 0 && all[i - 1]!.score === f.score ? null : i + 1,
      fancierId: f.fancierKey,
      fancierName: names.get(f.fancierKey) ?? f.fancierKey.replace(/^name:/, ""),
      score: f.score,
      birdsScored: f.birdsScored,
      benzingPositions: f.benzingPositions,
    })),
    excluded: calc.excluded.map((e) => ({ ...e, ring: byOrder.get(e.arrivalId)?.ring ?? null })),
  };
}

function fullResult(arrivals: StoredArrival[]) {
  return arrivals.map((a) => ({
    position: a.position,
    fancierName: a.fancierName,
    ring: a.ring,
    sex: a.sex,
    nomination: a.nomination,
    arrivalDay: a.arrivalDay,
    arrivalTime: a.arrivalTime,
    speed: a.speedMilli / 1000,
    distanceKm: a.distanceM / 1000,
    loft: `${a.loftOrder}/${a.loftBasketed}`,
  }));
}

export async function raceDetail(db: D1Database, raceId: number, now: Date, opts: { admin: boolean }) {
  const race = await getRace(db, raceId);
  const states = await raceStates(db, now);
  const names = await fancierNames(db);
  const sheet = await db
    .prepare("SELECT id, fetched_at, header_json, arrivals_json, benzing_recalculated, source_url FROM snapshot WHERE race_id = ? AND source = 'sheet' ORDER BY id DESC LIMIT 1")
    .bind(raceId)
    .first<{ id: number; fetched_at: string; header_json: string; arrivals_json: string; benzing_recalculated: string | null; source_url: string }>();
  const arrivals = sheet ? (JSON.parse(sheet.arrivals_json) as StoredArrival[]) : [];
  const header = sheet ? (JSON.parse(sheet.header_json) as { liberationPoint: string | null }) : null;

  const entries = await db
    .prepare("SELECT e.fancier_id, f.name, e.basketed, e.returned FROM race_entry e JOIN fancier f ON f.id = e.fancier_id WHERE e.race_id = ? ORDER BY f.name")
    .bind(raceId)
    .all<{ fancier_id: number; name: string; basketed: number; returned: number }>();
  const basketedKnown = entries.results.reduce((s, e) => s + e.basketed, 0);

  const loadCalc = async (status: "published" | "draft") => {
    const c = await db.prepare("SELECT * FROM race_calc WHERE race_id = ? AND status = ? ORDER BY id DESC LIMIT 1").bind(raceId, status).first<CalcRow>();
    if (!c) return null;
    const snapRow = await db.prepare("SELECT arrivals_json FROM snapshot WHERE id = ?").bind(c.snapshot_id).first<{ arrivals_json: string }>();
    const snapArrivals = snapRow ? (JSON.parse(snapRow.arrivals_json) as StoredArrival[]) : [];
    return {
      id: c.id,
      createdAt: c.created_at,
      createdBy: opts.admin ? c.created_by : undefined,
      publishedAt: c.published_at,
      settingsVersionId: c.settings_version_id,
      ...decorateCalc(JSON.parse(c.result_json) as StoredCalcResult, names, snapArrivals),
    };
  };
  const published = await loadCalc("published");

  const first = arrivals[0];
  const last = arrivals.at(-1);
  const detail = {
    race: raceSummary(race, states.get(race.id)!),
    liberationPoint: header?.liberationPoint ?? race.name,
    sheetFetchedAt: sheet?.fetched_at ?? null,
    benzingRecalculated: sheet?.benzing_recalculated ?? null,
    returned: arrivals.length,
    firstBird: first ? { fancierName: first.fancierName, ring: first.ring, arrivalTime: first.arrivalTime, arrivalDay: first.arrivalDay, speed: first.speedMilli / 1000 } : null,
    lastBird: last ? { fancierName: last.fancierName, ring: last.ring, arrivalTime: last.arrivalTime, arrivalDay: last.arrivalDay, speed: last.speedMilli / 1000 } : null,
    entries: entries.results.map((e) => ({ fancierId: e.fancier_id, fancierName: e.name, basketed: e.basketed, returned: e.returned })),
    unaccountedBasketed: race.basketed_total !== null && sheet ? Math.max(0, race.basketed_total - basketedKnown) : 0,
    fullResult: fullResult(arrivals),
    fiveBird: published,
  };
  if (!opts.admin) return detail;

  const overrides = await db
    .prepare("SELECT id, scope, target, reason, actor, created_at, revoked_at, revoked_by FROM override WHERE race_id = ? ORDER BY id DESC")
    .bind(raceId)
    .all();
  return {
    ...detail,
    draft: await loadCalc("draft"),
    overrides: overrides.results,
    benzingResultUrl: sheet?.source_url ?? null,
    resultTypes: race.results_json ? JSON.parse(race.results_json) : [],
    fullResultId: race.full_result_id,
  };
}

export async function championship(db: D1Database, season: number) {
  const settings = await currentSettings(db);
  const races = await db
    .prepare(
      `SELECT r.id, r.name, r.race_date, r.race_number, c.id AS calc_id FROM race r
       JOIN race_calc c ON c.race_id = r.id AND c.status = 'published'
       WHERE r.club_id = ? AND r.season = ? AND r.kind = 'race' AND r.included = 1
       ORDER BY r.race_date, r.race_number`,
    )
    .bind(CLUB_ID, season)
    .all<{ id: number; name: string; race_date: string; race_number: number | null; calc_id: number }>();
  const scores = await db
    .prepare(
      `SELECT s.race_calc_id, s.fancier_id, s.score FROM race_calc_score s
       JOIN race_calc c ON c.id = s.race_calc_id AND c.status = 'published'
       JOIN race r ON r.id = c.race_id WHERE r.club_id = ? AND r.season = ?`,
    )
    .bind(CLUB_ID, season)
    .all<{ race_calc_id: number; fancier_id: number; score: number }>();
  const names = await fancierNames(db);
  const standings = calculateSeason(
    races.results.map((r) => ({
      raceId: String(r.id),
      scores: scores.results.filter((s) => s.race_calc_id === r.calc_id).map((s) => ({ fancierKey: String(s.fancier_id), score: s.score })),
    })),
    { racesCounted: settings.races_counted === "all" ? "all" : { best: settings.best_x ?? races.results.length } },
  );
  return {
    season,
    settings: { scoringBirds: settings.scoring_birds, racesCounted: settings.races_counted, bestX: settings.best_x },
    races: races.results.map((r) => ({ id: r.id, name: r.name, date: r.race_date, number: r.race_number })),
    standings: standings.map((s) => ({
      rank: s.rank,
      fancierId: Number(s.fancierKey),
      fancierName: names.get(s.fancierKey) ?? "?",
      total: s.total,
      perRace: s.perRace,
      countedRaceIds: s.countedRaceIds,
    })),
  };
}

export async function fancierDetail(db: D1Database, fancierId: number, season: number) {
  const f = await db.prepare("SELECT id, name FROM fancier WHERE id = ? AND club_id = ?").bind(fancierId, CLUB_ID).first<{ id: number; name: string }>();
  if (!f) return null;
  const rows = await db
    .prepare(
      `SELECT r.id, r.name, r.race_date, r.kind, r.included, e.basketed, e.returned,
              (SELECT c.id FROM race_calc c WHERE c.race_id = r.id AND c.status = 'published' ORDER BY c.id DESC LIMIT 1) AS calc_id
       FROM race_entry e JOIN race r ON r.id = e.race_id
       WHERE e.fancier_id = ? AND r.season = ? ORDER BY r.race_date`,
    )
    .bind(fancierId, season)
    .all<{ id: number; name: string; race_date: string; kind: string; included: number; basketed: number; returned: number; calc_id: number | null }>();
  const races = [];
  for (const r of rows.results) {
    let fiveBird = null;
    if (r.calc_id) {
      const c = await db.prepare("SELECT result_json FROM race_calc WHERE id = ?").bind(r.calc_id).first<{ result_json: string }>();
      const calc = JSON.parse(c!.result_json) as StoredCalcResult;
      const mine = calc.lines.filter((l) => l.fancierKey === String(fancierId));
      fiveBird = {
        score: mine.reduce((s, l) => s + l.points, 0),
        birds: mine.map((l) => ({ ring: l.ring, benzingPosition: l.benzingPosition, scoringPosition: l.scoringPosition, points: l.points })),
        n: calc.n,
      };
    }
    races.push({ raceId: r.id, name: r.name, date: r.race_date, kind: r.kind, included: r.included === 1, basketed: r.basketed, returned: r.returned, fiveBird });
  }
  const champ = await championship(db, season);
  const standing = champ.standings.find((s) => s.fancierId === fancierId) ?? null;
  const basketed = races.reduce((s, r) => s + r.basketed, 0);
  const returned = races.reduce((s, r) => s + r.returned, 0);
  return {
    fancier: f,
    season,
    totals: { basketed, returned, returnPct: basketed ? Math.round((returned / basketed) * 1000) / 10 : null },
    standing: standing ? { rank: standing.rank, total: standing.total, of: champ.standings.length } : null,
    races,
  };
}

/** Live board: active races with provisional standings computed on read (never stored as results). */
export async function live(db: D1Database, now: Date) {
  const rows = await db.prepare("SELECT * FROM race WHERE club_id = ? AND live_mode != 'off'").bind(CLUB_ID).all<RaceRow>();
  const active = rows.results.filter((r) => isLiveActive(r, now));
  const settings = await currentSettings(db);
  const out = [];
  for (const race of active) {
    const snap = await db
      .prepare("SELECT fetched_at, arrivals_json FROM snapshot WHERE race_id = ? AND source = 'live' ORDER BY id DESC LIMIT 1")
      .bind(race.id)
      .first<{ fetched_at: string; arrivals_json: string }>();
    const arrivals = snap ? (JSON.parse(snap.arrivals_json) as StoredArrival[]) : [];
    // Provisional scoring keys on names: live fanciers may not have a row yet.
    const calc = await scoreSnapshot(db, arrivals, settings.scoring_birds, []);
    const names = new Map<string, string>([...(await fancierNames(db))]);
    for (const a of arrivals) names.set(`name:${a.fancierName}`, a.fancierName);
    out.push({
      race: raceSummary(race, "live"),
      lastPolledAt: race.live_last_polled_at,
      dataAsOf: snap?.fetched_at ?? null,
      arrivals: fullResult(arrivals),
      provisional: decorateCalc({ ...calc, warnings: [] }, names, arrivals),
    });
  }
  return { races: out, pollIntervalMinutes: 5 };
}

export async function home(db: D1Database, now: Date) {
  const season = await defaultSeason(db, now);
  const latest = await db
    .prepare(
      `SELECT r.id FROM race r JOIN race_calc c ON c.race_id = r.id AND c.status = 'published'
       WHERE r.club_id = ? ORDER BY r.race_date DESC LIMIT 1`,
    )
    .bind(CLUB_ID)
    .first<{ id: number }>();
  const next = await db
    .prepare("SELECT * FROM race WHERE club_id = ? AND race_date >= ? ORDER BY race_date LIMIT 1")
    .bind(CLUB_ID, sastDate(now))
    .first<RaceRow>();
  const champ = await championship(db, season);
  const latestDetail = latest ? await raceDetail(db, latest.id, now, { admin: false }) : null;
  const liveNow = await live(db, now);
  return {
    season,
    latestRace: latestDetail
      ? { race: latestDetail.race, returned: latestDetail.returned, top: latestDetail.fiveBird?.fanciers.slice(0, 5) ?? [], firstBird: latestDetail.firstBird }
      : null,
    championshipTop5: champ.standings.slice(0, 5),
    racesCounted: champ.races.length,
    nextRace: next ? raceSummary(next, isLiveActive(next, now) ? "live" : "upcoming") : null,
    liveRaces: liveNow.races.map((r) => ({ id: r.race.id, name: r.race.name, arrivals: r.arrivals.length })),
  };
}

export async function adminOverview(db: D1Database, now: Date) {
  const alerts = await db.prepare("SELECT * FROM alert WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 50").all();
  const drafts = await db
    .prepare("SELECT c.id, c.race_id, r.name, c.created_at FROM race_calc c JOIN race r ON r.id = c.race_id WHERE c.status = 'draft' ORDER BY c.id DESC")
    .all();
  const lastSync = await db.prepare("SELECT MAX(synced_at) AS at FROM race WHERE club_id = ?").bind(CLUB_ID).first<{ at: string | null }>();
  const lastLive = await db.prepare("SELECT MAX(live_last_polled_at) AS at FROM race WHERE club_id = ?").bind(CLUB_ID).first<{ at: string | null }>();
  const pw = await db.prepare("SELECT value FROM app_setting WHERE key = 'member_password'").first();
  return {
    alerts: alerts.results,
    drafts: drafts.results,
    lastRaceSync: lastSync?.at ?? null,
    lastLivePoll: lastLive?.at ?? null,
    memberPasswordSet: Boolean(pw),
    season: await defaultSeason(db, now),
    seasons: await seasons(db),
  };
}
