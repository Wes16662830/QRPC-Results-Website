/**
 * Parser for Benzing's on-the-fly (live) arrivals JSON. Public, no sign-in:
 *   GET /api/v2/za/club-races/{raceId}/on-the-fly/arrivals?page_number={1..}&limit=100
 * `limit` is capped at 100 by Benzing (HTTP 422 above that). Pages are 1-based.
 *
 * Used for the live board and provisional standings, and as a cross-check against the full result
 * sheet, which remains the source for published 5-bird results.
 */
import { BenzingParseError, parseDistanceM } from "./parseResultPage";

export const LIVE_PAGE_LIMIT = 100;

export interface LiveArrival {
  arrivalId: number;
  fancierId: number;
  fancierName: string;
  ring: string;
  /** Benzing's live rank: unique per bird (unlike the result sheet). */
  rank: number;
  nomination: number | null;
  arrivalDay: number;
  arrivalTime: string;
  speedMilli: number;
  distanceM: number;
  loftOrder: number;
  loftBasketed: number;
}

export interface LiveArrivalsPage {
  arrivals: LiveArrival[];
  pageCount: number;
  arrivalCount: number;
  raceStatus: string;
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new BenzingParseError(`${what} is not an object`);
  return v as Record<string, unknown>;
}

function int(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isInteger(v)) throw new BenzingParseError(`Field "${k}" is not an integer`);
  return v;
}

function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== "string") throw new BenzingParseError(`Field "${k}" is not a string`);
  return v;
}

/** "1279.742" → 1279742 ; tolerates dropped trailing zeros ("1094.04" → 1094040). */
export function parseLiveSpeedMilli(raw: string): number {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(raw);
  if (!m) throw new BenzingParseError(`Unexpected live speed format: "${raw}"`);
  return Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
}

export function parseLiveArrivalsPage(json: unknown): LiveArrivalsPage {
  const root = obj(json, "Response");
  if (!Array.isArray(root.arrivals)) throw new BenzingParseError(`Field "arrivals" is not an array`);
  const arrivals = root.arrivals.map((raw): LiveArrival => {
    const a = obj(raw, "Arrival");
    const time = str(a, "time_of_arrival");
    if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) throw new BenzingParseError(`Unexpected arrival time: "${time}"`);
    const distance = a.distance;
    if (typeof distance !== "number") throw new BenzingParseError(`Field "distance" is not a number`);
    return {
      arrivalId: int(a, "arrival_id"),
      fancierId: int(a, "fancier_id"),
      fancierName: str(a, "fancier_name"),
      ring: str(a, "pigeon_string"),
      rank: int(a, "rank_to_display"),
      nomination: typeof a.nomination === "number" ? a.nomination : null,
      arrivalDay: int(a, "day_of_arrival"),
      arrivalTime: time,
      speedMilli: parseLiveSpeedMilli(str(a, "speed")),
      // Benzing sends distance as a JSON float (km); render with 3 dp and parse exactly.
      distanceM: parseDistanceM(distance.toFixed(3)),
      loftOrder: int(a, "loft_position"),
      loftBasketed: int(a, "basketed_pigeons"),
    };
  });
  return {
    arrivals,
    pageCount: int(root, "page_count"),
    arrivalCount: int(root, "arrival_count"),
    raceStatus: str(root, "race_status"),
  };
}

/** Joins pages and checks that nothing was lost or duplicated between page fetches. */
export function combineLivePages(pages: readonly LiveArrivalsPage[]): LiveArrival[] {
  if (pages.length === 0) return [];
  const expectedCount = pages[0]!.arrivalCount;
  const all = pages.flatMap((p) => p.arrivals);
  if (pages.some((p) => p.arrivalCount !== expectedCount)) {
    throw new BenzingParseError("Arrival count changed between pages; retry the whole fetch");
  }
  if (all.length !== expectedCount) {
    throw new BenzingParseError(`Got ${all.length} arrivals across pages, expected ${expectedCount}`);
  }
  if (new Set(all.map((a) => a.arrivalId)).size !== all.length) {
    throw new BenzingParseError("Duplicate arrival across pages; retry the whole fetch");
  }
  return all;
}
