/**
 * Parser for Benzing's season race lists (public JSON):
 *   GET /api/v2/{country}/smartclub/{orgId}/{season}/races
 *   GET /api/v2/{country}/smartclub/{orgId}/{season}/training-races
 */
import { BenzingParseError } from "./parseResultPage";

export interface BenzingResultSummary {
  id: number;
  typeName: string;
  percentage: number;
  active: boolean;
}

export interface BenzingRace {
  benzingRaceId: number;
  season: number;
  raceNumber: number | null;
  name: string;
  slug: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM:SS, or null when Benzing has none yet ("00:00:00"). */
  liberationTime: string | null;
  minDistanceM: number | null;
  maxDistanceM: number | null;
  basketedTotal: number;
  fanciersTotal: number;
  status: string;
  results: BenzingResultSummary[];
}

function rec(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new BenzingParseError(`${what} is not an object`);
  return v as Record<string, unknown>;
}

function num(v: unknown, what: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new BenzingParseError(`${what} is not a number`);
  return n;
}

function s(v: unknown, what: string): string {
  if (typeof v !== "string") throw new BenzingParseError(`${what} is not a string`);
  return v;
}

const km = (v: unknown) => (v === null || v === undefined || v === 0 ? null : Math.round(num(v, "distance") * 1000));

export function parseRaceList(json: unknown): BenzingRace[] {
  const root = rec(json, "Response");
  if (!Array.isArray(root.clubRaces)) throw new BenzingParseError(`Field "clubRaces" is not an array`);
  return root.clubRaces.map((raw) => {
    const r = rec(raw, "Race");
    const date = s(r.rawDate, "rawDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BenzingParseError(`Unexpected rawDate "${date}"`);
    const lib = s(r.liberationTime, "liberationTime");
    if (!/^\d{2}:\d{2}:\d{2}$/.test(lib)) throw new BenzingParseError(`Unexpected liberationTime "${lib}"`);
    const results = Array.isArray(r.results) ? r.results : [];
    return {
      benzingRaceId: num(r.id, "id"),
      season: num(r.season, "season"),
      raceNumber: r.order ? num(r.order, "order") : null,
      name: s(r.raceName, "raceName").trim(),
      slug: s(r.raceNameSlug, "raceNameSlug"),
      date,
      liberationTime: lib === "00:00:00" ? null : lib,
      minDistanceM: km(r.minimumDistance),
      maxDistanceM: km(r.maximumDistance),
      basketedTotal: num(r.numberOfPigeons, "numberOfPigeons"),
      fanciersTotal: num(r.numberOfFanciers, "numberOfFanciers"),
      status: s(r.raceStatus, "raceStatus"),
      results: results.map((x) => {
        const res = rec(x, "Result");
        const type = rec(res.race_result_type, "race_result_type");
        return {
          id: num(res.id, "result id"),
          typeName: s(type.type_name, "type_name").replace(/\s+/g, " ").trim(),
          percentage: num(type.percentage, "percentage"),
          active: num(type.active, "active") === 1,
        };
      }),
    };
  });
}

/**
 * The full results sheet = the result whose type lists 100 % of arrivals.
 * Prefers a type named "FULL POINTS"; never falls back to a partial (prize-list) result.
 */
export function pickFullResult(results: readonly BenzingResultSummary[]): BenzingResultSummary | null {
  const full = results.filter((r) => r.percentage === 100);
  return full.find((r) => /full points/i.test(r.typeName)) ?? full.find((r) => !/test/i.test(r.typeName)) ?? full[0] ?? null;
}
