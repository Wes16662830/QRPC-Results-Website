/**
 * Application services. All Benzing access goes through BenzingClient; all scoring through core/scoring.
 * Nothing here is triggered on a timer except pollLive (cron worker, every 5 minutes).
 */
import { pickFullResult, type BenzingRace } from "../core/benzing/parseRaceList";
import type { LiveArrival } from "../core/benzing/parseLiveArrivals";
import type { Override, RaceCalculation } from "../core/scoring/fiveBird";
import { getSystem } from "../core/scoring/systems";
import { BenzingClient, BenzingError, type ClubRef } from "./benzingClient";
import { CLUB_ID, type D1Database } from "./env";

// ---------- shared types ----------

export interface StoredArrival {
  listOrder: number;
  position: number;
  fancierName: string;
  benzingFancierId: number | null;
  ring: string;
  sex: "cock" | "hen" | null;
  nomination: number | null;
  arrivalDay: number;
  arrivalTime: string;
  speedMilli: number;
  distanceM: number;
  loftOrder: number;
  loftBasketed: number;
}

export interface RaceRow {
  id: number;
  benzing_race_id: number;
  season: number;
  race_number: number | null;
  name: string;
  slug: string;
  race_date: string;
  liberation_time_local: string | null;
  liberation_point: string | null;
  min_distance_m: number | null;
  max_distance_m: number | null;
  basketed_total: number | null;
  fanciers_total: number | null;
  benzing_status: string | null;
  kind: "race" | "training";
  included: number;
  full_result_id: number | null;
  results_json: string | null;
  live_mode: "auto" | "on" | "off";
  live_last_polled_at: string | null;
  synced_at: string | null;
}

export interface CompetitionRow {
  id: number;
  name: string;
  slug: string;
  system: string;
  display_order: number;
  active: number;
  /** Latest version: */
  version_id: number;
  params_json: string;
  races_counted: "all" | "best";
  best_x: number | null;
  version_created_at: string;
  version_actor: string;
}

export interface CalcRow {
  id: number;
  race_id: number;
  snapshot_id: number;
  competition_id: number;
  competition_version_id: number;
  overrides_json: string;
  result_json: string;
  inputs_sha256: string;
  status: "draft" | "published" | "superseded";
  created_at: string;
  created_by: string;
  published_at: string | null;
  published_by: string | null;
}

/** Stored with each draft: warnings that must be acknowledged before publishing. */
export interface StoredCalcResult extends RaceCalculation {
  warnings: string[];
}

export class UserError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "UserError";
  }
}

export interface Ctx {
  db: D1Database;
  benzing: BenzingClient;
  now: () => Date;
}

// ---------- helpers ----------

const iso = (d: Date) => d.toISOString();
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // Africa/Johannesburg, no daylight saving

/** Local (SAST) date + time → UTC Date. */
export function sastToUtc(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time}Z`) - SAST_OFFSET_MS);
}

/** UTC → local SAST date "YYYY-MM-DD". */
export function sastDate(d: Date): string {
  return new Date(d.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function club(db: D1Database): Promise<ClubRef> {
  const c = await db.prepare("SELECT country, benzing_org_id FROM club WHERE id = ?").bind(CLUB_ID).first<{ country: string; benzing_org_id: number }>();
  if (!c) throw new Error("Club row missing; run migrations");
  return { country: c.country, benzingOrgId: c.benzing_org_id };
}

export async function audit(db: D1Database, now: Date, actor: string, action: string, entity?: string, entityId?: string | number, detail?: unknown) {
  await db
    .prepare("INSERT INTO audit_log (at, actor, action, entity, entity_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(iso(now), actor, action, entity ?? null, entityId === undefined ? null : String(entityId), detail === undefined ? null : JSON.stringify(detail))
    .run();
}

export async function raiseAlert(db: D1Database, now: Date, level: "info" | "warning" | "error", source: string, message: string, raceId: number | null = null) {
  const existing = await db
    .prepare("SELECT id FROM alert WHERE resolved_at IS NULL AND source = ? AND message = ? AND race_id IS ?")
    .bind(source, message, raceId)
    .first();
  if (existing) return;
  await db.prepare("INSERT INTO alert (at, level, source, race_id, message) VALUES (?, ?, ?, ?, ?)").bind(iso(now), level, source, raceId, message).run();
}

export async function getRace(db: D1Database, raceId: number): Promise<RaceRow> {
  const r = await db.prepare("SELECT * FROM race WHERE id = ? AND club_id = ?").bind(raceId, CLUB_ID).first<RaceRow>();
  if (!r) throw new UserError("Race not found", 404);
  return r;
}

const COMPETITION_SQL = `SELECT c.id, c.name, c.slug, c.system, c.display_order, c.active,
    v.id AS version_id, v.params_json, v.races_counted, v.best_x, v.created_at AS version_created_at, v.actor AS version_actor
  FROM competition c JOIN competition_version v ON v.id = (SELECT MAX(id) FROM competition_version WHERE competition_id = c.id)
  WHERE c.club_id = ?`;

export async function competitions(db: D1Database, opts: { activeOnly?: boolean } = {}): Promise<CompetitionRow[]> {
  const rows = await db.prepare(`${COMPETITION_SQL}${opts.activeOnly ? " AND c.active = 1" : ""} ORDER BY c.display_order, c.id`).bind(CLUB_ID).all<CompetitionRow>();
  return rows.results;
}

export async function competition(db: D1Database, idOrSlug: number | string): Promise<CompetitionRow> {
  const col = typeof idOrSlug === "number" ? "c.id" : "c.slug";
  const c = await db.prepare(`${COMPETITION_SQL} AND ${col} = ?`).bind(CLUB_ID, idOrSlug).first<CompetitionRow>();
  if (!c) throw new UserError("Competition not found", 404);
  return c;
}

/** Races excluded from a competition (beyond race-level kind/included). */
export async function competitionExclusions(db: D1Database, competitionId: number): Promise<Set<number>> {
  const rows = await db.prepare("SELECT race_id FROM competition_exclusion WHERE competition_id = ?").bind(competitionId).all<{ race_id: number }>();
  return new Set(rows.results.map((r) => r.race_id));
}

// ---------- sync race list (admin button) ----------

/*
 * Cloudflare's free plan allows only 50 D1 queries per request, so writes are grouped with db.batch()
 * (one query each) and lookups are done once, not per row.
 */

/** Statements that insert or refresh races from Benzing. Admin choices (kind, included, live_mode) are kept. */
async function upsertRaces(db: D1Database, items: { r: BenzingRace; kind: "race" | "training" }[], now: Date) {
  if (items.length === 0) return;
  const rows = await db.prepare("SELECT id, benzing_race_id FROM race WHERE club_id = ?").bind(CLUB_ID).all<{ id: number; benzing_race_id: number }>();
  const existing = new Map(rows.results.map((x) => [x.benzing_race_id, x.id]));
  const stmts = items.map(({ r, kind }) => {
    const full = pickFullResult(r.results);
    const fields = [
      r.season, r.raceNumber, r.name, r.slug, r.date, r.liberationTime, r.minDistanceM, r.maxDistanceM,
      r.basketedTotal, r.fanciersTotal, r.status, full?.id ?? null, JSON.stringify(r.results), iso(now),
    ];
    const id = existing.get(r.benzingRaceId);
    if (id !== undefined) {
      return db
        .prepare(
          `UPDATE race SET season=?, race_number=?, name=?, slug=?, race_date=?, liberation_time_local=?, min_distance_m=?, max_distance_m=?,
           basketed_total=?, fanciers_total=?, benzing_status=?, full_result_id=?, results_json=?, synced_at=? WHERE id=?`,
        )
        .bind(...fields, id);
    }
    return db
      .prepare(
        `INSERT INTO race (season, race_number, name, slug, race_date, liberation_time_local, min_distance_m, max_distance_m,
         basketed_total, fanciers_total, benzing_status, full_result_id, results_json, synced_at, club_id, benzing_race_id, kind)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(...fields, CLUB_ID, r.benzingRaceId, kind);
  });
  await db.batch(stmts);
}

export async function syncRaces(ctx: Ctx, season: number, actor: string): Promise<{ races: number; trainings: number }> {
  const c = await club(ctx.db);
  const now = ctx.now();
  let races: BenzingRace[];
  let trainings: BenzingRace[];
  try {
    races = await ctx.benzing.raceList(c, season, "races");
    trainings = await ctx.benzing.raceList(c, season, "training-races");
  } catch (e) {
    await raiseAlert(ctx.db, now, "error", "sync-races", `Could not read the ${season} race list from Benzing: ${(e as Error).message}`);
    throw new UserError(`Benzing race list failed: ${(e as Error).message}`, 502);
  }
  await upsertRaces(ctx.db, [...races.map((r) => ({ r, kind: "race" as const })), ...trainings.map((r) => ({ r, kind: "training" as const }))], now);
  await audit(ctx.db, now, actor, "sync-races", "season", season, { races: races.length, trainings: trainings.length });
  return { races: races.length, trainings: trainings.length };
}

// ---------- calculate results (admin button) ----------

/** Creates or updates fanciers (matched by Benzing id, then by name). Returns name → our id. Three queries in total. */
async function upsertFanciers(db: D1Database, people: { name: string; benzingId: number | null }[]): Promise<Map<string, number>> {
  type Row = { id: number; name: string; benzing_fancier_id: number | null };
  const load = async () => (await db.prepare("SELECT id, name, benzing_fancier_id FROM fancier WHERE club_id = ?").bind(CLUB_ID).all<Row>()).results;
  const rows = await load();
  const stmts = [];
  for (const p of people) {
    const byId = p.benzingId === null ? undefined : rows.find((r) => r.benzing_fancier_id === p.benzingId);
    if (byId) {
      if (byId.name !== p.name) stmts.push(db.prepare("UPDATE fancier SET name = ? WHERE id = ?").bind(p.name, byId.id));
      continue;
    }
    const byName = rows.find((r) => r.name === p.name);
    if (byName) {
      if (p.benzingId !== null && byName.benzing_fancier_id === null) {
        stmts.push(db.prepare("UPDATE fancier SET benzing_fancier_id = ? WHERE id = ?").bind(p.benzingId, byName.id));
      }
      continue;
    }
    stmts.push(db.prepare("INSERT INTO fancier (club_id, name, benzing_fancier_id) VALUES (?, ?, ?)").bind(CLUB_ID, p.name, p.benzingId));
  }
  if (stmts.length === 0) return new Map(rows.map((r) => [r.name, r.id]));
  await db.batch(stmts);
  return new Map((await load()).map((r) => [r.name, r.id]));
}

/** Compares the result sheet with the live feed. Returns human-readable differences (max 10). */
export function crossCheck(sheet: readonly StoredArrival[], live: readonly LiveArrival[]): string[] {
  const out: string[] = [];
  if (sheet.length !== live.length) out.push(`Result sheet has ${sheet.length} birds but the live feed has ${live.length}.`);
  const liveByRing = new Map(live.map((a) => [a.ring, a]));
  for (const s of sheet) {
    const l = liveByRing.get(s.ring);
    if (!l) out.push(`${s.ring} (${s.fancierName}) is on the result sheet but not in the live feed.`);
    else if (l.speedMilli !== s.speedMilli) out.push(`${s.ring}: speed ${s.speedMilli / 1000} on the sheet, ${l.speedMilli / 1000} live.`);
  }
  const sheetRings = new Set(sheet.map((s) => s.ring));
  for (const l of live) if (!sheetRings.has(l.ring)) out.push(`${l.ring} (${l.fancierName}) is in the live feed but not on the result sheet.`);
  return out.length > 10 ? [...out.slice(0, 10), `…and ${out.length - 10} more differences.`] : out;
}

async function latestSnapshot(db: D1Database, raceId: number, source: "sheet" | "live") {
  return db
    .prepare("SELECT * FROM snapshot WHERE race_id = ? AND source = ? ORDER BY id DESC LIMIT 1")
    .bind(raceId, source)
    .first<{ id: number; content_sha256: string; arrivals_json: string; header_json: string | null; fetched_at: string; benzing_recalculated: string | null; source_url: string }>();
}

async function activeOverrides(db: D1Database, raceId: number): Promise<(Override & { id: number })[]> {
  const rows = await db
    .prepare("SELECT id, scope, target, reason FROM override WHERE race_id = ? AND revoked_at IS NULL ORDER BY id")
    .bind(raceId)
    .all<{ id: number; scope: "bird" | "fancier"; target: string; reason: string }>();
  return rows.results;
}

async function fancierIdsByName(db: D1Database): Promise<Map<string, number>> {
  const rows = await db.prepare("SELECT id, name FROM fancier WHERE club_id = ?").bind(CLUB_ID).all<{ id: number; name: string }>();
  return new Map(rows.results.map((r) => [r.name, r.id]));
}

/** Runs a competition's scoring system on stored arrivals. Fancier key = our fancier id (as text). */
export async function scoreSnapshot(db: D1Database, arrivals: readonly StoredArrival[], comp: Pick<CompetitionRow, "system" | "params_json">, overrides: readonly Override[]) {
  const ids = await fancierIdsByName(db);
  const system = getSystem(comp.system);
  return system.score(
    arrivals.map((a) => ({
      id: String(a.listOrder),
      fancierKey: String(ids.get(a.fancierName) ?? `name:${a.fancierName}`),
      ring: a.ring,
      speedMilli: a.speedMilli,
      benzingPosition: a.position,
      listOrder: a.listOrder,
    })),
    system.parse(JSON.parse(comp.params_json)),
    overrides,
  );
}

/** Creates a new draft for one competition from the latest sheet snapshot, unless nothing changed. */
async function createDraft(db: D1Database, race: RaceRow, comp: CompetitionRow, actor: string, now: Date, warnings: string[]): Promise<{ competitionId: number; calcId: number; changed: boolean }> {
  const snap = await latestSnapshot(db, race.id, "sheet");
  if (!snap) throw new UserError("No result sheet stored for this race yet. Press Calculate results first.");
  const overrides = await activeOverrides(db, race.id);
  const engineOverrides = overrides.map(({ scope, target, reason }) => ({ scope, target, reason }));
  const arrivals = JSON.parse(snap.arrivals_json) as StoredArrival[];
  const calc = await scoreSnapshot(db, arrivals, comp, engineOverrides);
  const inputsHash = await sha256(JSON.stringify({ snapshot: snap.content_sha256, system: comp.system, params: comp.params_json, overrides: engineOverrides }));

  const latest = await db
    .prepare("SELECT id, inputs_sha256 FROM race_calc WHERE race_id = ? AND competition_id = ? AND status IN ('draft','published') ORDER BY id DESC LIMIT 1")
    .bind(race.id, comp.id)
    .first<{ id: number; inputs_sha256: string }>();
  if (latest && latest.inputs_sha256 === inputsHash && warnings.length === 0) return { competitionId: comp.id, calcId: latest.id, changed: false };

  await db.prepare("UPDATE race_calc SET status = 'superseded' WHERE race_id = ? AND competition_id = ? AND status = 'draft'").bind(race.id, comp.id).run();
  const stored: StoredCalcResult = { ...calc, warnings };
  const res = await db
    .prepare(
      `INSERT INTO race_calc (race_id, competition_id, competition_version_id, snapshot_id, overrides_json, result_json, inputs_sha256, status, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .bind(race.id, comp.id, comp.version_id, snap.id, JSON.stringify(overrides), JSON.stringify(stored), inputsHash, iso(now), actor)
    .run();
  const calcId = res.meta.last_row_id!;
  const stmts = calc.fanciers
    .filter((f) => /^\d+$/.test(f.fancierKey))
    .map((f) =>
      db.prepare("INSERT INTO race_calc_score (race_calc_id, fancier_id, birds_scored, score) VALUES (?, ?, ?, ?)").bind(calcId, Number(f.fancierKey), f.birdsScored, f.score),
    );
  if (stmts.length) await db.batch(stmts);
  await audit(db, now, actor, "draft-created", "race", race.id, { calcId, competition: comp.slug, n: calc.n, competitionVersion: comp.version_id, overrides: overrides.length, warnings });
  return { competitionId: comp.id, calcId, changed: true };
}

/** Drafts for every active competition (or just one). */
async function createDrafts(db: D1Database, race: RaceRow, actor: string, now: Date, warnings: string[], only?: number) {
  const out = [];
  for (const comp of await competitions(db, { activeOnly: true })) {
    if (only === undefined || comp.id === only) out.push(await createDraft(db, race, comp, actor, now, warnings));
  }
  return out;
}

export async function calculateResults(ctx: Ctx, raceId: number, actor: string): Promise<{ drafts: { competitionId: number; calcId: number; changed: boolean }[]; changed: boolean; warnings: string[] }> {
  const now = ctx.now();
  let race = await getRace(ctx.db, raceId);
  const c = await club(ctx.db);

  // Refresh the race list first: Benzing may have added the full result since the last sync.
  try {
    const list = await ctx.benzing.raceList(c, race.season, race.kind === "race" ? "races" : "training-races");
    const fresh = list.find((r) => r.benzingRaceId === race.benzing_race_id);
    if (fresh) await upsertRaces(ctx.db, [{ r: fresh, kind: race.kind }], now);
    race = await getRace(ctx.db, raceId);
  } catch (e) {
    throw new UserError(`Could not reach Benzing: ${(e as Error).message}`, 502);
  }
  if (!race.full_result_id) {
    throw new UserError("Benzing has no full (100 %) result for this race yet. Ask the race processor to calculate the FULL POINTS result in Benzing, then try again.");
  }

  let sheetArrivals: StoredArrival[];
  let header: unknown;
  let url: string;
  let recalculated: string | null;
  let live: LiveArrival[] | null = null;
  try {
    const sheet = await ctx.benzing.resultSheet(c, race.benzing_race_id, race.full_result_id, race.slug);
    url = sheet.url;
    header = sheet.page.header;
    recalculated = sheet.page.header.lastRecalculation;
    try {
      live = (await ctx.benzing.liveArrivals(c, race.benzing_race_id)).arrivals;
    } catch {
      live = null;
    }
    const liveIdByRing = new Map((live ?? []).map((a) => [a.ring, a.fancierId]));
    sheetArrivals = sheet.page.arrivals.map((a) => ({
      listOrder: a.listOrder,
      position: a.position,
      fancierName: a.fancierName,
      benzingFancierId: liveIdByRing.get(a.ring) ?? null,
      ring: a.ring,
      sex: a.sex,
      nomination: a.nomination,
      arrivalDay: a.arrivalDay,
      arrivalTime: a.arrivalTime,
      speedMilli: a.speedMilli,
      distanceM: a.distanceM,
      loftOrder: a.loftOrder,
      loftBasketed: a.loftBasketed,
    }));
  } catch (e) {
    const msg = e instanceof BenzingError || e instanceof Error ? e.message : String(e);
    await raiseAlert(ctx.db, now, "error", "calculate", `Result sheet could not be imported: ${msg}`, race.id);
    throw new UserError(`Result sheet could not be imported, so nothing was changed: ${msg}`, 502);
  }

  const warnings = live === null ? ["The live feed could not be read, so the result sheet was not cross-checked."] : crossCheck(sheetArrivals, live);
  const basketedSum = new Map(sheetArrivals.map((a) => [a.fancierName, a.loftBasketed]));
  const sumBasketed = [...basketedSum.values()].reduce((s, n) => s + n, 0);

  // Store the snapshot only if the content changed.
  const content = JSON.stringify(sheetArrivals);
  const hash = await sha256(content);
  const prev = await latestSnapshot(ctx.db, race.id, "sheet");
  if (!prev || prev.content_sha256 !== hash) {
    await ctx.db
      .prepare(
        `INSERT INTO snapshot (race_id, source, fetched_at, source_url, content_sha256, header_json, arrivals_json, arrival_count, benzing_recalculated)
         VALUES (?, 'sheet', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(race.id, iso(now), url, hash, JSON.stringify(header), content, sheetArrivals.length, recalculated)
      .run();
  }

  // Fanciers and basketed/returned.
  const returned = new Map<string, number>();
  for (const a of sheetArrivals) returned.set(a.fancierName, (returned.get(a.fancierName) ?? 0) + 1);
  const firstIdByName = new Map<string, number | null>();
  for (const a of sheetArrivals) if (!firstIdByName.get(a.fancierName)) firstIdByName.set(a.fancierName, a.benzingFancierId);
  const ids = await upsertFanciers(ctx.db, [...basketedSum.keys()].map((name) => ({ name, benzingId: firstIdByName.get(name) ?? null })));
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM race_entry WHERE race_id = ?").bind(race.id),
    ...[...basketedSum].map(([name, basketed]) =>
      ctx.db.prepare("INSERT INTO race_entry (race_id, fancier_id, basketed, returned) VALUES (?, ?, ?, ?)").bind(race.id, ids.get(name)!, basketed, returned.get(name) ?? 0),
    ),
  ]);
  if (race.basketed_total !== null && sumBasketed < race.basketed_total) {
    warnings.push(
      `${race.basketed_total - sumBasketed} basketed birds belong to fanciers with no birds home; Benzing does not name them publicly.`,
    );
  }

  await ctx.db.prepare("UPDATE race SET live_mode = 'off' WHERE id = ?").bind(race.id).run();
  await audit(ctx.db, now, actor, "calculate-results", "race", race.id, { arrivals: sheetArrivals.length, resultId: race.full_result_id });
  const blocking = warnings.filter((w) => !w.includes("Benzing does not name them"));
  const drafts = await createDrafts(ctx.db, race, actor, now, blocking);
  if (blocking.length) await raiseAlert(ctx.db, now, "warning", "cross-check", `${race.name}: result sheet and live feed differ. Review before publishing.`, race.id);
  return { drafts, changed: drafts.some((d) => d.changed), warnings };
}

export async function recalculateRace(ctx: Ctx, raceId: number, actor: string, competitionId?: number) {
  const race = await getRace(ctx.db, raceId);
  const drafts = await createDrafts(ctx.db, race, actor, ctx.now(), [], competitionId);
  return { drafts, changed: drafts.some((d) => d.changed) };
}

export async function recalculateSeason(ctx: Ctx, season: number, actor: string, competitionId?: number) {
  const races = await ctx.db
    .prepare("SELECT r.id FROM race r WHERE r.club_id = ? AND r.season = ? AND EXISTS (SELECT 1 FROM snapshot s WHERE s.race_id = r.id AND s.source = 'sheet') ORDER BY r.race_date")
    .bind(CLUB_ID, season)
    .all<{ id: number }>();
  const out: { raceId: number; changed: boolean }[] = [];
  for (const r of races.results) out.push({ raceId: r.id, changed: (await recalculateRace(ctx, r.id, actor, competitionId)).changed });
  await audit(ctx.db, ctx.now(), actor, "recalculate-season", "season", season, out);
  return out;
}

/** Publishes every current draft for the race (one approval covers all competitions). */
export async function publish(ctx: Ctx, raceId: number, actor: string, acknowledgeWarnings: boolean) {
  const now = ctx.now();
  const drafts = await ctx.db.prepare("SELECT * FROM race_calc WHERE race_id = ? AND status = 'draft'").bind(raceId).all<CalcRow>();
  if (drafts.results.length === 0) throw new UserError("There is no draft to publish.");
  const warnings = [...new Set(drafts.results.flatMap((d) => (JSON.parse(d.result_json) as StoredCalcResult).warnings))];
  if (warnings.length && !acknowledgeWarnings) throw new UserError("This draft has warnings. Review them and confirm before publishing.", 409);
  const stmts = drafts.results.flatMap((d) => [
    ctx.db.prepare("UPDATE race_calc SET status = 'superseded' WHERE race_id = ? AND competition_id = ? AND status = 'published'").bind(raceId, d.competition_id),
    ctx.db.prepare("UPDATE race_calc SET status = 'published', published_at = ?, published_by = ? WHERE id = ?").bind(iso(now), actor, d.id),
  ]);
  await ctx.db.batch(stmts);
  await audit(ctx.db, now, actor, "publish", "race", raceId, { calcIds: drafts.results.map((d) => d.id), warningsAcknowledged: warnings });
}

export async function addOverride(ctx: Ctx, raceId: number, scope: "bird" | "fancier", target: string, reason: string, actor: string) {
  const now = ctx.now();
  if (!reason.trim()) throw new UserError("A reason is required.");
  const snap = await latestSnapshot(ctx.db, raceId, "sheet");
  if (!snap) throw new UserError("Calculate results before adding a disqualification.");
  const arrivals = JSON.parse(snap.arrivals_json) as StoredArrival[];
  if (scope === "bird" && !arrivals.some((a) => a.ring === target)) throw new UserError(`Ring ${target} is not in this race's result.`);
  if (scope === "fancier") {
    const f = await ctx.db.prepare("SELECT name FROM fancier WHERE id = ? AND club_id = ?").bind(Number(target), CLUB_ID).first<{ name: string }>();
    if (!f || !arrivals.some((a) => a.fancierName === f.name)) throw new UserError("That fancier has no birds in this race.");
  }
  const res = await ctx.db
    .prepare("INSERT INTO override (race_id, scope, target, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(raceId, scope, target, reason.trim(), actor, iso(now))
    .run();
  await audit(ctx.db, now, actor, "override-add", "race", raceId, { overrideId: res.meta.last_row_id, scope, target, reason });
  return recalculateRace(ctx, raceId, actor);
}

export async function revokeOverride(ctx: Ctx, overrideId: number, actor: string) {
  const now = ctx.now();
  const o = await ctx.db.prepare("SELECT race_id, revoked_at FROM override WHERE id = ?").bind(overrideId).first<{ race_id: number; revoked_at: string | null }>();
  if (!o) throw new UserError("Override not found", 404);
  if (o.revoked_at) throw new UserError("Already revoked.");
  await ctx.db.prepare("UPDATE override SET revoked_at = ?, revoked_by = ? WHERE id = ?").bind(iso(now), actor, overrideId).run();
  await audit(ctx.db, now, actor, "override-revoke", "race", o.race_id, { overrideId });
  return recalculateRace(ctx, o.race_id, actor);
}

export async function updateRace(ctx: Ctx, raceId: number, patch: { kind?: string; included?: boolean; liveMode?: string }, actor: string) {
  const race = await getRace(ctx.db, raceId);
  const kind = patch.kind ?? race.kind;
  const liveMode = patch.liveMode ?? race.live_mode;
  if (kind !== "race" && kind !== "training") throw new UserError("kind must be race or training");
  if (!["auto", "on", "off"].includes(liveMode)) throw new UserError("liveMode must be auto, on or off");
  const included = patch.included === undefined ? race.included : patch.included ? 1 : 0;
  await ctx.db.prepare("UPDATE race SET kind = ?, included = ?, live_mode = ? WHERE id = ?").bind(kind, included, liveMode, raceId).run();
  await audit(ctx.db, ctx.now(), actor, "race-update", "race", raceId, {
    before: { kind: race.kind, included: race.included, liveMode: race.live_mode },
    after: { kind, included, liveMode },
  });
}

export interface CompetitionInput {
  name?: string;
  params?: unknown;
  racesCounted?: "all" | "best";
  bestX?: number | null;
  active?: boolean;
  displayOrder?: number;
}

function validCounting(racesCounted: string, bestX: number | null | undefined) {
  if (racesCounted !== "all" && racesCounted !== "best") throw new UserError("Races counted must be all or best.");
  if (racesCounted === "best" && (!Number.isInteger(bestX) || bestX! < 1)) throw new UserError("Best X must be a positive whole number.");
}

/** New settings version for a competition. Parameter changes create fresh drafts for its stored races. */
export async function updateCompetition(ctx: Ctx, competitionId: number, input: CompetitionInput, actor: string, season: number) {
  const before = await competition(ctx.db, competitionId);
  const system = getSystem(before.system);
  const now = ctx.now();
  let params: Record<string, unknown>;
  try {
    params = input.params === undefined ? JSON.parse(before.params_json) : system.parse(input.params);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  const racesCounted = input.racesCounted ?? before.races_counted;
  const bestX = racesCounted === "best" ? (input.bestX === undefined ? before.best_x : input.bestX) : null;
  validCounting(racesCounted, bestX);
  const name = input.name?.trim() || before.name;
  const active = input.active === undefined ? before.active : input.active ? 1 : 0;
  const order = input.displayOrder ?? before.display_order;
  await ctx.db.prepare("UPDATE competition SET name = ?, active = ?, display_order = ? WHERE id = ?").bind(name, active, order, competitionId).run();
  const paramsJson = JSON.stringify(params);
  const versionChanged = paramsJson !== before.params_json || racesCounted !== before.races_counted || bestX !== before.best_x;
  if (versionChanged) {
    await ctx.db
      .prepare("INSERT INTO competition_version (competition_id, params_json, races_counted, best_x, created_at, actor) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(competitionId, paramsJson, racesCounted, bestX, iso(now), actor)
      .run();
  }
  await audit(ctx.db, now, actor, "competition-update", "competition", competitionId, {
    before: { name: before.name, params: before.params_json, racesCounted: before.races_counted, bestX: before.best_x, active: before.active },
    after: { name, params: paramsJson, racesCounted, bestX, active },
  });
  // Scoring changes alter race results: create fresh drafts for the admin to review and publish.
  if (paramsJson !== before.params_json || (active && !before.active)) return recalculateSeason(ctx, season, actor, competitionId);
  return [];
}

export async function createCompetition(ctx: Ctx, input: { name: string; system: string; params?: unknown; racesCounted?: "all" | "best"; bestX?: number | null }, actor: string, season: number) {
  const now = ctx.now();
  let system;
  let params;
  try {
    system = getSystem(input.system);
    params = system.parse(input.params ?? system.defaults);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  const name = (input.name ?? "").trim();
  if (!name) throw new UserError("Name is required.");
  const racesCounted = input.racesCounted ?? "all";
  const bestX = racesCounted === "best" ? input.bestX ?? null : null;
  validCounting(racesCounted, bestX);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "competition";
  const taken = await ctx.db.prepare("SELECT 1 FROM competition WHERE club_id = ? AND slug = ?").bind(CLUB_ID, slug).first();
  if (taken) throw new UserError("A competition with that name already exists.");
  const maxOrder = await ctx.db.prepare("SELECT COALESCE(MAX(display_order), 0) AS m FROM competition WHERE club_id = ?").bind(CLUB_ID).first<{ m: number }>();
  const res = await ctx.db
    .prepare("INSERT INTO competition (club_id, name, slug, system, display_order, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
    .bind(CLUB_ID, name, slug, system.id, (maxOrder?.m ?? 0) + 1, iso(now))
    .run();
  const id = res.meta.last_row_id!;
  await ctx.db
    .prepare("INSERT INTO competition_version (competition_id, params_json, races_counted, best_x, created_at, actor) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, JSON.stringify(params), racesCounted, bestX, iso(now), actor)
    .run();
  await audit(ctx.db, now, actor, "competition-create", "competition", id, { name, system: system.id, params, racesCounted, bestX });
  await recalculateSeason(ctx, season, actor, id);
  return { id, slug };
}

export async function setCompetitionRace(ctx: Ctx, competitionId: number, raceId: number, included: boolean, actor: string) {
  await competition(ctx.db, competitionId);
  await getRace(ctx.db, raceId);
  if (included) await ctx.db.prepare("DELETE FROM competition_exclusion WHERE competition_id = ? AND race_id = ?").bind(competitionId, raceId).run();
  else await ctx.db.prepare("INSERT OR IGNORE INTO competition_exclusion (competition_id, race_id) VALUES (?, ?)").bind(competitionId, raceId).run();
  await audit(ctx.db, ctx.now(), actor, "competition-race", "competition", competitionId, { raceId, included });
}

// ---------- live (cron, every 5 minutes) ----------

const LIVE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** When does live polling run for this race? (pure; tested) */
export function isLiveActive(race: Pick<RaceRow, "kind" | "live_mode" | "race_date" | "liberation_time_local">, now: Date): boolean {
  if (race.live_mode === "off") return false;
  const start = sastToUtc(race.race_date, race.liberation_time_local ?? "06:00:00");
  if (race.live_mode === "on") return now.getTime() < start.getTime() + LIVE_WINDOW_MS;
  if (race.kind !== "race") return false;
  return now >= start && now.getTime() < start.getTime() + LIVE_WINDOW_MS;
}

export async function pollLive(ctx: Ctx): Promise<{ polled: number[] }> {
  const now = ctx.now();
  // Cheap DB-only check first: candidate races are those dated within the last 3 days or switched on.
  const from = sastDate(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000));
  const candidates = await ctx.db
    .prepare("SELECT * FROM race WHERE club_id = ? AND live_mode != 'off' AND (race_date >= ? OR live_mode = 'on')")
    .bind(CLUB_ID, from)
    .all<RaceRow>();
  const active = candidates.results.filter((r) => isLiveActive(r, now));
  if (active.length === 0) return { polled: [] };
  const c = await club(ctx.db);
  const polled: number[] = [];
  for (const race of active) {
    try {
      const live = await ctx.benzing.liveArrivals(c, race.benzing_race_id);
      const arrivals: StoredArrival[] = live.arrivals.map((a, i) => ({
        listOrder: i + 1,
        position: a.rank,
        fancierName: a.fancierName,
        benzingFancierId: a.fancierId,
        ring: a.ring,
        sex: null,
        nomination: a.nomination,
        arrivalDay: a.arrivalDay,
        arrivalTime: a.arrivalTime,
        speedMilli: a.speedMilli,
        distanceM: a.distanceM,
        loftOrder: a.loftOrder,
        loftBasketed: a.loftBasketed,
      }));
      const content = JSON.stringify(arrivals);
      const hash = await sha256(content);
      const prev = await latestSnapshot(ctx.db, race.id, "live");
      if (!prev || prev.content_sha256 !== hash) {
        await ctx.db
          .prepare("INSERT INTO snapshot (race_id, source, fetched_at, source_url, content_sha256, arrivals_json, arrival_count) VALUES (?, 'live', ?, ?, ?, ?, ?)")
          .bind(race.id, iso(now), live.url, hash, content, arrivals.length)
          .run();
      }
      await ctx.db.prepare("UPDATE race SET live_last_polled_at = ?, benzing_status = ? WHERE id = ?").bind(iso(now), live.raceStatus, race.id).run();
      polled.push(race.id);
    } catch (e) {
      await raiseAlert(ctx.db, now, "warning", "live", `Live feed for ${race.name} failed: ${(e as Error).message}. Showing the last good data.`, race.id);
    }
  }
  return { polled };
}
