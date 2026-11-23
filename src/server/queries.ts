/** Read models for the site. Members only ever see PUBLISHED 5-bird results. */
import { calculateSeason } from "../core/scoring/fiveBird";
import { applyDistanceFactor } from "../core/scoring/distance";
import { ratioSeason } from "../core/scoring/extraSystems";
import { getSystem, MissingRaceSettings, usesBaseRace } from "../core/scoring/systems";
import { CLUB_ID, type D1Database } from "./env";
import {
  baseBirdsFor, distanceFor, competition as loadCompetition, competitionExclusions, competitionInclusions, competitionUsesRace, competitions, getRace, isLiveActive, raceParamsFor, sastDate, scoreSnapshot, UserError,
  type CalcRow, type CompetitionRow, type RaceRow, type StoredArrival, type StoredCalcResult,
} from "./services";

/** Public description of a competition. */
export function competitionInfo(c: CompetitionRow) {
  const system = getSystem(c.system);
  // Normalised through the system so new options (e.g. the 5-bird points scale) show their default.
  const params = system.parse(JSON.parse(c.params_json)) as Record<string, unknown>;
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    system: c.system,
    systemName: system.name,
    params,
    rules:
      system.describe(params) +
      (c.distance_weighting && system.distanceWeighting
        ? " Points grow with distance: every point in a race is multiplied by its distance ÷ the season's first race distance (average of the shortest and longest loft)."
        : ""),
    distanceWeighting: Boolean(c.distance_weighting && system.distanceWeighting),
    supportsDistanceWeighting: Boolean(system.distanceWeighting),
    racesCounted: c.races_counted,
    bestX: c.best_x,
    active: c.active === 1,
    displayOrder: c.display_order,
    visibility: c.visibility,
    raceSelection: c.race_selection,
    entity: system.entity,
    seasonMode: system.season,
    unit: system.unit,
    /** Settings the admin sets per race (e.g. closing time); empty for most systems. */
    raceFields: system.raceFields ?? [],
  };
}

/** Members see active, member-visible competitions only. */
export async function listCompetitions(db: D1Database, opts: { activeOnly?: boolean; membersOnly?: boolean } = { activeOnly: true, membersOnly: true }) {
  return (await competitions(db, opts)).map(competitionInfo);
}

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
  const rows = await db
    .prepare(
      `SELECT r.*,
        EXISTS (SELECT 1 FROM snapshot s WHERE s.race_id = r.id AND s.source = 'sheet') AS has_sheet,
        EXISTS (SELECT 1 FROM race_calc c WHERE c.race_id = r.id AND c.status = 'draft') AS has_draft_calc
       FROM race r WHERE r.club_id = ? AND r.season = ? ORDER BY r.race_date, r.race_number`,
    )
    .bind(CLUB_ID, season)
    .all<RaceRow & { has_sheet: number; has_draft_calc: number }>();
  const states = await raceStates(db, now);
  return rows.results.map((r) => ({
    ...raceSummary(r, states.get(r.id)!),
    /** Results imported from Benzing at least once. */
    calculated: r.has_sheet === 1,
    /** A draft is waiting to be published (possibly replacing a published result). */
    draftWaiting: r.has_draft_calc === 1,
    hasFullResult: r.full_result_id !== null,
  }));
}

function decorateCalc(calc: StoredCalcResult, names: Map<string, string>, arrivals: StoredArrival[]) {
  const byOrder = new Map(arrivals.map((a) => [String(a.listOrder), a]));
  return {
    n: calc.n,
    warnings: calc.warnings ?? [],
    distance: calc.distance ?? null,
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
      points: f.points,
      basketed: f.basketed,
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

async function buildRaceDetail(db: D1Database, raceId: number, now: Date, opts: { admin: boolean }) {
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

  const loadCalc = async (competitionId: number, status: "published" | "draft") => {
    const c = await db
      .prepare("SELECT * FROM race_calc WHERE race_id = ? AND competition_id = ? AND status = ? ORDER BY id DESC LIMIT 1")
      .bind(raceId, competitionId, status)
      .first<CalcRow>();
    if (!c) return null;
    const snapRow = await db.prepare("SELECT arrivals_json FROM snapshot WHERE id = ?").bind(c.snapshot_id).first<{ arrivals_json: string }>();
    const snapArrivals = snapRow ? (JSON.parse(snapRow.arrivals_json) as StoredArrival[]) : [];
    return {
      id: c.id,
      createdAt: c.created_at,
      createdBy: opts.admin ? c.created_by : undefined,
      publishedAt: c.published_at,
      competitionVersionId: c.competition_version_id,
      ...decorateCalc(JSON.parse(c.result_json) as StoredCalcResult, names, snapArrivals),
    };
  };
  const comps = await competitions(db, opts.admin ? {} : { activeOnly: true, membersOnly: true });
  const raceParams = opts.admin ? await raceParamsFor(db, raceId) : new Map<number, Record<string, unknown>>();
  const results = [];
  for (const comp of comps) {
    const uses = await competitionUsesRace(db, comp, raceId);
    if (!opts.admin && !uses) continue;
    const published = await loadCalc(comp.id, "published");
    const draft = opts.admin ? await loadCalc(comp.id, "draft") : null;
    results.push({ competition: competitionInfo(comp), published, draft, raceParams: raceParams.get(comp.id) ?? null, usesRace: uses });
  }

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
    results,
    sourceUrl: opts.admin ? (sheet?.source_url ?? null) : null,
  };
  return detail;
}

/** What members see: published results only. */
export function raceDetail(db: D1Database, raceId: number, now: Date) {
  return buildRaceDetail(db, raceId, now, { admin: false });
}

/** Admin view: adds drafts, disqualifications and the Benzing source. */
export async function adminRaceDetail(db: D1Database, raceId: number, now: Date) {
  const detail = await buildRaceDetail(db, raceId, now, { admin: true });
  const race = await getRace(db, raceId);
  const overrides = await db
    .prepare("SELECT id, scope, target, reason, actor, created_at, revoked_at, revoked_by FROM override WHERE race_id = ? ORDER BY id DESC")
    .bind(raceId)
    .all<{ id: number; scope: "bird" | "fancier"; target: string; reason: string; actor: string; created_at: string; revoked_at: string | null; revoked_by: string | null }>();
  return {
    ...detail,
    overrides: overrides.results,
    benzingResultUrl: detail.sourceUrl,
    resultTypes: race.results_json ? (JSON.parse(race.results_json) as { id: number; typeName: string; percentage: number; active: boolean }[]) : [],
    fullResultId: race.full_result_id,
  };
}

/** Season standings for one competition, from PUBLISHED race results only. */
export async function championship(
  db: D1Database,
  competitionRef: number | string | null,
  season: number,
  opts: { admin?: boolean; upTo?: { date: string; number: number | null } } = {},
) {
  const comp =
    competitionRef === null ? (await competitions(db, { activeOnly: true, membersOnly: !opts.admin }))[0]! : await loadCompetition(db, competitionRef);
  if (!opts.admin && comp.visibility !== "members") throw new UserError("Competition not found", 404);
  const system = getSystem(comp.system);
  const picked = comp.race_selection === "picked" ? await competitionInclusions(db, comp.id) : null;
  const excluded = await competitionExclusions(db, comp.id);
  const races = (
    await db
      .prepare(
        `SELECT r.id, r.name, r.race_date, r.race_number, c.id AS calc_id FROM race r
         JOIN race_calc c ON c.race_id = r.id AND c.status = 'published' AND c.competition_id = ?
         WHERE r.club_id = ? AND r.season = ? AND r.kind = 'race' AND r.included = 1
         ORDER BY r.race_date, r.race_number`,
      )
      .bind(comp.id, CLUB_ID, season)
      .all<{ id: number; name: string; race_date: string; race_number: number | null; calc_id: number }>()
  ).results
    .filter((r) => (picked ? picked.has(r.id) : !excluded.has(r.id)))
    // "As of" a race (weekly leaderboard): only races up to and including it.
    .filter((r) => !opts.upTo || r.race_date < opts.upTo.date || (r.race_date === opts.upTo.date && (r.race_number ?? 0) <= (opts.upTo.number ?? 0)));
  const names = await fancierNames(db);
  const racesCounted = comp.races_counted === "all" ? ("all" as const) : { best: comp.best_x ?? races.length };
  const base = {
    season,
    competition: competitionInfo(comp),
    races: races.map((r) => ({ id: r.id, name: r.name, date: r.race_date, number: r.race_number })),
  };

  if (system.entity === "bird") {
    // Bird standings: points add up per ring, from the published race results.
    const calcs = races.length
      ? await db
          .prepare(`SELECT id, result_json FROM race_calc WHERE id IN (${races.map(() => "?").join(",")})`)
          .bind(...races.map((r) => r.calc_id))
          .all<{ id: number; result_json: string }>()
      : { results: [] };
    const owner = new Map<string, string>();
    const perRace = races.map((r) => {
      const calc = JSON.parse(calcs.results.find((c) => c.id === r.calc_id)!.result_json) as StoredCalcResult;
      for (const l of calc.lines) owner.set(l.ring, l.fancierKey);
      return { raceId: String(r.id), scores: calc.lines.map((l) => ({ fancierKey: l.ring, score: l.points })) };
    });
    const standings = calculateSeason(perRace, { racesCounted });
    return {
      ...base,
      standings: standings.map((s) => {
        const fk = owner.get(s.fancierKey) ?? "";
        return {
          rank: s.rank,
          ring: s.fancierKey,
          fancierId: /^\d+$/.test(fk) ? Number(fk) : null,
          fancierName: names.get(fk) ?? fk.replace(/^name:/, ""),
          total: s.total,
          perRace: s.perRace,
          countedRaceIds: s.countedRaceIds,
          racesScored: Object.values(s.perRace).filter((v) => v > 0).length,
        };
      }),
    };
  }

  const scores = await db
    .prepare(
      `SELECT s.race_calc_id, s.fancier_id, s.score, s.points, s.basketed FROM race_calc_score s
       JOIN race_calc c ON c.id = s.race_calc_id AND c.status = 'published' AND c.competition_id = ?
       JOIN race r ON r.id = c.race_id WHERE r.club_id = ? AND r.season = ?`,
    )
    .bind(comp.id, CLUB_ID, season)
    .all<{ race_calc_id: number; fancier_id: number; score: number; points: number | null; basketed: number | null }>();
  const forRace = (calcId: number) => scores.results.filter((s) => s.race_calc_id === calcId);

  if (system.season === "ratio") {
    const standings = ratioSeason(
      races.map((r) => ({
        raceId: String(r.id),
        scores: forRace(r.calc_id).map((s) => ({ fancierKey: String(s.fancier_id), points: s.points ?? 0, basketed: s.basketed ?? 0 })),
      })),
    );
    return {
      ...base,
      standings: standings.map((s) => ({
        rank: s.rank,
        fancierId: Number(s.fancierKey),
        fancierName: names.get(s.fancierKey) ?? "?",
        total: s.total,
        points: s.points,
        basketed: s.basketed,
        perRace: s.perRace,
        countedRaceIds: s.countedRaceIds,
      })),
    };
  }

  const standings = calculateSeason(
    races.map((r) => ({ raceId: String(r.id), scores: forRace(r.calc_id).map((s) => ({ fancierKey: String(s.fancier_id), score: s.score })) })),
    { racesCounted },
  );
  return {
    ...base,
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
      `SELECT r.id, r.name, r.race_date, r.kind, r.included, e.basketed, e.returned
       FROM race_entry e JOIN race r ON r.id = e.race_id
       WHERE e.fancier_id = ? AND r.season = ? ORDER BY r.race_date`,
    )
    .bind(fancierId, season)
    .all<{ id: number; name: string; race_date: string; kind: string; included: number; basketed: number; returned: number }>();
  // Bird competitions rank birds, not fanciers, so they are left off the fancier page.
  const comps = (await competitions(db, { activeOnly: true, membersOnly: true })).filter((c) => getSystem(c.system).entity === "fancier");
  const published = await db
    .prepare(
      `SELECT c.race_id, c.competition_id, c.result_json FROM race_calc c JOIN race r ON r.id = c.race_id
       WHERE c.status = 'published' AND r.season = ? AND r.club_id = ?`,
    )
    .bind(season, CLUB_ID)
    .all<{ race_id: number; competition_id: number; result_json: string }>();
  const races = rows.results.map((r) => {
    const perCompetition: Record<string, { score: number; n: number; birds: { ring: string; benzingPosition: number; scoringPosition: number; points: number }[] } | null> = {};
    for (const comp of comps) {
      const calcRow = published.results.find((p) => p.race_id === r.id && p.competition_id === comp.id);
      if (!calcRow) {
        perCompetition[comp.slug] = null;
        continue;
      }
      const calc = JSON.parse(calcRow.result_json) as StoredCalcResult;
      const mine = calc.lines.filter((l) => l.fancierKey === String(fancierId));
      perCompetition[comp.slug] = {
        score: mine.reduce((s, l) => s + l.points, 0),
        n: calc.n,
        birds: mine.map((l) => ({ ring: l.ring, benzingPosition: l.benzingPosition, scoringPosition: l.scoringPosition, points: l.points })),
      };
    }
    return { raceId: r.id, name: r.name, date: r.race_date, kind: r.kind, included: r.included === 1, basketed: r.basketed, returned: r.returned, results: perCompetition };
  });
  const standings = [];
  for (const comp of comps) {
    const champ = await championship(db, comp.id, season);
    const s = champ.standings.find((x) => x.fancierId === fancierId);
    standings.push({ competition: competitionInfo(comp), rank: s?.rank ?? null, total: s?.total ?? 0, of: champ.standings.length });
  }
  const basketed = races.reduce((s, r) => s + r.basketed, 0);
  const returned = races.reduce((s, r) => s + r.returned, 0);
  return {
    fancier: f,
    season,
    competitions: comps.map(competitionInfo),
    totals: { basketed, returned, returnPct: basketed ? Math.round((returned / basketed) * 1000) / 10 : null },
    standings,
    races,
  };
}

/** Live board: active races with provisional standings computed on read (never stored as results). */
export async function live(db: D1Database, now: Date) {
  const rows = await db.prepare("SELECT * FROM race WHERE club_id = ? AND live_mode != 'off'").bind(CLUB_ID).all<RaceRow>();
  const active = rows.results.filter((r) => isLiveActive(r, now));
  const comps = await competitions(db, { activeOnly: true, membersOnly: true });
  const out = [];
  for (const race of active) {
    const raceParams = await raceParamsFor(db, race.id);
    const snap = await db
      .prepare("SELECT fetched_at, arrivals_json FROM snapshot WHERE race_id = ? AND source = 'live' ORDER BY id DESC LIMIT 1")
      .bind(race.id)
      .first<{ fetched_at: string; arrivals_json: string }>();
    const arrivals = snap ? (JSON.parse(snap.arrivals_json) as StoredArrival[]) : [];
    // Provisional scoring keys on names when a live fancier has no row yet.
    const names = new Map<string, string>([...(await fancierNames(db))]);
    for (const a of arrivals) names.set(`name:${a.fancierName}`, a.fancierName);
    const provisional = [];
    for (const comp of comps) {
      try {
        const system = getSystem(comp.system);
        const baseBirds = usesBaseRace(system, system.parse(JSON.parse(comp.params_json))) ? await baseBirdsFor(db, comp, race.season) : null;
        const distance = await distanceFor(db, comp, race);
        const raw = await scoreSnapshot(db, arrivals, comp, [], raceParams.get(comp.id) ?? null, race.basketed_total, baseBirds);
        const calc = distance ? { ...applyDistanceFactor(raw, distance.factor), distance } : raw;
        provisional.push({ competition: competitionInfo(comp), result: decorateCalc({ ...calc, warnings: [] }, names, arrivals) });
      } catch (e) {
        if (!(e instanceof MissingRaceSettings)) throw e; // e.g. no closing time set yet: leave this competition out
      }
    }
    out.push({
      race: raceSummary(race, "live"),
      lastPolledAt: race.live_last_polled_at,
      dataAsOf: snap?.fetched_at ?? null,
      arrivals: fullResult(arrivals),
      provisional,
    });
  }
  return { races: out, pollIntervalMinutes: 5 };
}

/**
 * Time by which the winner beat another bird, over the winner's distance: distance ÷ speed for each bird,
 * in seconds to 1 decimal. Speeds are m/min × 1000, distance in metres.
 */
export function winningMarginSeconds(winnerDistanceM: number, winnerSpeedMilli: number, otherSpeedMilli: number): number {
  const minutes = (speedMilli: number) => winnerDistanceM / (speedMilli / 1000);
  return Math.round((minutes(otherSpeedMilli) - minutes(winnerSpeedMilli)) * 60 * 10) / 10;
}

/**
 * "Season so far" facts for the home page, from published races only (a race counts once any of its
 * results is published, so members never see figures from races still being checked).
 */
export async function seasonStats(db: D1Database, season: number) {
  const races = (
    await db
      .prepare(
        `SELECT r.id, r.name, r.race_date, r.basketed_total,
                (SELECT arrivals_json FROM snapshot s WHERE s.race_id = r.id AND s.source = 'sheet' ORDER BY s.id DESC LIMIT 1) AS arrivals_json
         FROM race r
         WHERE r.club_id = ? AND r.season = ? AND r.kind = 'race' AND r.included = 1
           AND EXISTS (SELECT 1 FROM race_calc c WHERE c.race_id = r.id AND c.status = 'published')
         ORDER BY r.race_date, r.race_number`,
      )
      .bind(CLUB_ID, season)
      .all<{ id: number; name: string; race_date: string; basketed_total: number | null; arrivals_json: string | null }>()
  ).results.filter((r) => r.arrivals_json);
  if (races.length === 0) return null;
  const withArrivals = races.map((r) => ({ ...r, arrivals: JSON.parse(r.arrivals_json!) as StoredArrival[] }));

  const basketed = races.reduce((sum, r) => sum + (r.basketed_total ?? 0), 0);
  // Returns are counted per race (a bird home in 9 races counts 9 times); uniqueHome counts each ring once.
  // Unique birds BASKETED can't be known: Benzing only publishes basketed counts, not which birds.
  const home = withArrivals.reduce((sum, r) => sum + r.arrivals.length, 0);
  const uniqueHome = new Set(withArrivals.flatMap((r) => r.arrivals.map((a) => a.ring))).size;

  // Fastest bird of the season.
  let fastest: { ring: string; fancierName: string; speed: number; raceId: number; raceName: string } | null = null;
  for (const r of withArrivals) {
    const a = r.arrivals[0];
    if (a && (!fastest || a.speedMilli / 1000 > fastest.speed)) fastest = { ring: a.ring, fancierName: a.fancierName, speed: a.speedMilli / 1000, raceId: r.id, raceName: r.name };
  }

  // Race wins (first bird in the full result).
  const winsBy = new Map<string, number>();
  for (const r of withArrivals) {
    const a = r.arrivals[0];
    if (a) winsBy.set(a.fancierName, (winsBy.get(a.fancierName) ?? 0) + 1);
  }
  const wins = [...winsBy].map(([fancierName, n]) => ({ fancierName, wins: n })).sort((a, b) => b.wins - a.wins || a.fancierName.localeCompare(b.fancierName));

  // Winning margins: the winning bird against the best bird of another fancier. Lofts are at different
  // distances, so the gap is in time over the WINNER's distance: how much later the runner-up's bird would
  // have arrived flying that distance at its own speed (distance ÷ speed, in seconds).
  type Margin = { raceId: number; raceName: string; seconds: number; speedGap: number; first: string; second: string };
  let closest: Margin | null = null;
  let biggest: Margin | null = null;
  for (const r of withArrivals) {
    const a = r.arrivals[0];
    const b = a ? r.arrivals.find((x) => x.fancierName !== a.fancierName) : undefined;
    if (!a || !b) continue;
    const seconds = winningMarginSeconds(a.distanceM, a.speedMilli, b.speedMilli);
    const m: Margin = { raceId: r.id, raceName: r.name, seconds, speedGap: (a.speedMilli - b.speedMilli) / 1000, first: a.fancierName, second: b.fancierName };
    if (!closest || seconds < closest.seconds) closest = m;
    if (!biggest || seconds > biggest.seconds) biggest = m;
  }

  // Birds home in every race so far.
  const counts = new Map<string, { ring: string; fancierName: string; n: number; bestPosition: number }>();
  for (const r of withArrivals) {
    for (const a of r.arrivals) {
      const c = counts.get(a.ring) ?? { ring: a.ring, fancierName: a.fancierName, n: 0, bestPosition: Infinity };
      c.n += 1;
      c.bestPosition = Math.min(c.bestPosition, a.position);
      counts.set(a.ring, c);
    }
  }
  const everyRace = [...counts.values()].filter((c) => c.n === races.length).sort((a, b) => a.bestPosition - b.bestPosition || a.ring.localeCompare(b.ring));

  // Return rate per fancier (min. 10 birds basketed, so a 2-from-2 doesn't top the table).
  const entries = await db
    .prepare(
      `SELECT f.id, f.name, SUM(e.basketed) AS basketed, SUM(e.returned) AS returned FROM race_entry e
       JOIN fancier f ON f.id = e.fancier_id
       WHERE e.race_id IN (${races.map(() => "?").join(",")}) GROUP BY f.id, f.name`,
    )
    .bind(...races.map((r) => r.id))
    .all<{ id: number; name: string; basketed: number; returned: number }>();
  const returnRate = entries.results
    .filter((e) => e.basketed >= 10)
    .map((e) => ({ fancierId: e.id, fancierName: e.name, basketed: e.basketed, returned: e.returned, pct: Math.round((e.returned / e.basketed) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct || b.returned - a.returned);

  // Best bird so far: the member-visible best-bird competition, if there is one.
  const comps = await competitions(db, { activeOnly: true, membersOnly: true });
  const birdComp = comps.find((c) => c.slug === "best-bird") ?? comps.find((c) => getSystem(c.system).entity === "bird");
  const bestBird = birdComp ? await championship(db, birdComp.id, season) : null;

  return {
    racesFlown: races.length,
    /** Basketings: one per bird per race. */
    basketed,
    /** Returns: one per bird per race. */
    home,
    /** Different birds (rings) home at least once. */
    uniqueHome,
    returnPct: basketed ? Math.round((home / basketed) * 1000) / 10 : null,
    fastest,
    wins: wins.slice(0, 3),
    closest,
    biggest,
    everyRace: { count: everyRace.length, top: everyRace.slice(0, 5).map(({ ring, fancierName }) => ({ ring, fancierName })) },
    returnRate: returnRate.slice(0, 3),
    bestBird: bestBird
      ? { competition: bestBird.competition.name, slug: bestBird.competition.slug, top: bestBird.standings.slice(0, 3).map((s) => ({ rank: s.rank, ring: "ring" in s ? s.ring : "", fancierName: s.fancierName, total: s.total })) }
      : null,
  };
}

/** Home page for one season (default: the latest season with races). */
export async function home(db: D1Database, now: Date, seasonParam?: number) {
  const season = seasonParam ?? (await defaultSeason(db, now));
  const latest = await db
    .prepare(
      `SELECT r.id FROM race r JOIN race_calc c ON c.race_id = r.id AND c.status = 'published'
       WHERE r.club_id = ? AND r.season = ? ORDER BY r.race_date DESC LIMIT 1`,
    )
    .bind(CLUB_ID, season)
    .first<{ id: number }>();
  const next = await db
    .prepare("SELECT * FROM race WHERE club_id = ? AND season = ? AND kind = 'race' AND race_date >= ? ORDER BY race_date LIMIT 1")
    .bind(CLUB_ID, season, sastDate(now))
    .first<RaceRow>();
  const champ = await championship(db, null, season);
  const latestDetail = latest ? await raceDetail(db, latest.id, now) : null;
  const liveNow = await live(db, now);
  return {
    season,
    latestRace: latestDetail
      ? {
          race: latestDetail.race,
          returned: latestDetail.returned,
          competition: champ.competition,
          top: latestDetail.results.find((r) => r.competition.id === champ.competition.id)?.published?.fanciers.slice(0, 5) ?? [],
          firstBird: latestDetail.firstBird,
        }
      : null,
    competition: champ.competition,
    championshipTop5: champ.standings.slice(0, 5),
    racesCounted: champ.races.length,
    nextRace: next ? raceSummary(next, isLiveActive(next, now) ? "live" : "upcoming") : null,
    liveRaces: liveNow.races.map((r) => ({ id: r.race.id, name: r.race.name, arrivals: r.arrivals.length })),
    stats: await seasonStats(db, season),
  };
}

/**
 * Weekly leaderboard: standings of the club championship and the best-bird competition as of one race
 * (default: the latest published race of the season), with movement since the previous week.
 */
export async function leaderboard(
  db: D1Database,
  season: number,
  opts: { raceId?: number; club?: string | null; bird?: string | null } = {},
) {
  const comps = await competitions(db, { activeOnly: true, membersOnly: true });
  const clubComp = (opts.club ? comps.find((c) => c.slug === opts.club) : null) ?? comps.find((c) => getSystem(c.system).entity === "fancier") ?? null;
  const birdComp = (opts.bird ? comps.find((c) => c.slug === opts.bird) : null) ?? comps.find((c) => c.slug === "best-bird") ?? comps.find((c) => getSystem(c.system).entity === "bird") ?? null;
  if (!clubComp) throw new UserError("No club championship to show.", 404);

  // Weeks = races of the season with a published club-championship result.
  const weeks = (
    await db
      .prepare(
        `SELECT r.id, r.name, r.race_date, r.race_number, r.basketed_total FROM race r
         WHERE r.club_id = ? AND r.season = ? AND r.kind = 'race' AND r.included = 1
           AND EXISTS (SELECT 1 FROM race_calc c WHERE c.race_id = r.id AND c.competition_id = ? AND c.status = 'published')
         ORDER BY r.race_date, r.race_number`,
      )
      .bind(CLUB_ID, season, clubComp.id)
      .all<{ id: number; name: string; race_date: string; race_number: number | null; basketed_total: number | null }>()
  ).results;
  const seasonRaces = await db.prepare("SELECT COUNT(*) AS n FROM race WHERE club_id = ? AND season = ? AND kind = 'race' AND included = 1").bind(CLUB_ID, season).first<{ n: number }>();
  const index = opts.raceId ? weeks.findIndex((w) => w.id === opts.raceId) : weeks.length - 1;
  if (index < 0) {
    if (opts.raceId) throw new UserError("That race has no published result yet.", 404);
    return { season, weeks: [], week: null, club: null, bird: null };
  }
  const week = weeks[index]!;
  const prev = weeks[index - 1] ?? null;
  const at = (w: { race_date: string; race_number: number | null }) => ({ date: w.race_date, number: w.race_number });

  const withMovement = async (comp: CompetitionRow, limit: number) => {
    const now = await championship(db, comp.id, season, { upTo: at(week) });
    const before = prev ? await championship(db, comp.id, season, { upTo: at(prev) }) : null;
    const key = (s: { ring?: string; fancierId: number | null }) => s.ring ?? String(s.fancierId);
    const prevRank = new Map((before?.standings ?? []).map((s) => [key(s as { ring?: string; fancierId: number | null }), s.rank]));
    const leader = now.standings[0]?.total ?? 0;
    return {
      competition: now.competition,
      racesCounted: now.races.length,
      standings: now.standings.slice(0, limit).map((s) => {
        const p = prevRank.get(key(s as { ring?: string; fancierId: number | null }));
        return {
          ...s,
          thisWeek: s.perRace[String(week.id)] ?? 0,
          previousRank: p ?? null,
          movement: before === null ? null : p === undefined ? "new" : p - s.rank,
          behind: Math.round((leader - s.total) * 100) / 100,
        };
      }),
      total: now.standings.length,
    };
  };

  const detail = await raceDetail(db, week.id, new Date());
  const raceResult = detail.results.find((r) => r.competition.id === clubComp.id)?.published ?? null;
  return {
    season,
    weeks: weeks.map((w, i) => ({ id: w.id, name: w.name, date: w.race_date, number: w.race_number, week: i + 1 })),
    week: {
      number: index + 1,
      of: seasonRaces?.n ?? weeks.length,
      race: { id: week.id, name: week.name, date: week.race_date, raceNumber: week.race_number, basketed: week.basketed_total, returned: detail.returned },
      firstBird: detail.firstBird,
      podium: raceResult ? raceResult.fanciers.slice(0, 3) : [],
    },
    club: await withMovement(clubComp, 10),
    bird: birdComp ? await withMovement(birdComp, 10) : null,
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
