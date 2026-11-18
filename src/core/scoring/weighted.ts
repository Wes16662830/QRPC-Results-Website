/**
 * Weighted-by-basketing system (agreed with Wes, 18 Nov 2026). Pure functions, no I/O.
 *
 *  1. Start from every arrival on Benzing's full result sheet; remove disqualified birds/fanciers.
 *  2. Only birds clocked at or before the race's closing time score. The closing time is set by
 *     the admin per race as a day number (1 = liberation day) and a SAST clock time.
 *  3. Birds inside the cutoff are ranked by speed (exact ties keep Benzing's listing order).
 *     With N birds inside the cutoff: points = N − position + 1. No limit per fancier.
 *  4. A fancier's race score = their total points ÷ birds they basketed for that race,
 *     rounded to 2 decimals. Fanciers with birds home but none inside the cutoff score 0.
 */
import type { ArrivalInput, Override, RaceCalculation, ScoringLine } from "./fiveBird";

export interface Closing {
  /** 1 = liberation day, 2 = the next day, … */
  day: number;
  /** "HH:MM" or "HH:MM:SS", SAST */
  time: string;
}

export function parseClosing(raw: unknown): Closing {
  if (typeof raw !== "object" || raw === null) throw new RangeError("Closing time is missing.");
  const r = raw as Record<string, unknown>;
  const day = Number(r.closingDay);
  if (!Number.isInteger(day) || day < 1 || day > 14) throw new RangeError("Closing day must be a whole number from 1 to 14.");
  const time = String(r.closingTime ?? "");
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(time);
  if (!m) throw new RangeError("Closing time must be HH:MM (24-hour, SAST).");
  return { day, time: `${m[1]}:${m[2]}:${m[3] ?? "00"}` };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function calculateWeightedRace(arrivals: readonly ArrivalInput[], closing: Closing, overrides: readonly Override[] = []): RaceCalculation {
  const ids = new Set<string>();
  for (const a of arrivals) {
    if (!Number.isInteger(a.speedMilli) || a.speedMilli < 0) throw new RangeError(`Invalid speed for arrival ${a.id}`);
    if (!Number.isInteger(a.listOrder)) throw new RangeError(`Invalid listOrder for arrival ${a.id}`);
    if (!Number.isInteger(a.arrivalDay) || !/^\d{2}:\d{2}:\d{2}$/.test(a.arrivalTime ?? "")) throw new RangeError(`Arrival ${a.id} has no arrival day/time`);
    if (!Number.isInteger(a.basketed) || a.basketed! < 1) throw new RangeError(`Arrival ${a.id} has no basketed count`);
    if (ids.has(a.id)) throw new RangeError(`Duplicate arrival id ${a.id}`);
    ids.add(a.id);
  }

  const dqBirds = new Map(overrides.filter((o) => o.scope === "bird").map((o) => [o.target, o.reason]));
  const dqFanciers = new Map(overrides.filter((o) => o.scope === "fancier").map((o) => [o.target, o.reason]));
  const excluded: RaceCalculation["excluded"] = [];
  const eligible: ArrivalInput[] = [];
  for (const a of arrivals) {
    const reason = dqFanciers.get(a.fancierKey) ?? dqBirds.get(a.ring);
    if (reason !== undefined) excluded.push({ arrivalId: a.id, reason });
    else eligible.push(a);
  }

  // Arrival day/time compare as "D:HH:MM:SS" with zero-padded day.
  const key = (day: number, time: string) => `${String(day).padStart(2, "0")}:${time}`;
  const cutoff = key(closing.day, closing.time);
  const inside = eligible
    .filter((a) => key(a.arrivalDay!, a.arrivalTime!) <= cutoff)
    .sort((x, y) => y.speedMilli - x.speedMilli || x.listOrder - y.listOrder);

  const n = inside.length;
  const lines: ScoringLine[] = inside.map((a, i) => ({
    arrivalId: a.id,
    fancierKey: a.fancierKey,
    ring: a.ring,
    speedMilli: a.speedMilli,
    benzingPosition: a.benzingPosition,
    scoringPosition: i + 1,
    points: n - i,
  }));

  // Every fancier with an eligible bird is listed (birds home but none inside the cutoff score 0).
  const fanciers = new Map<string, { fancierKey: string; birdsScored: number; points: number; basketed: number; benzingPositions: number[]; firstPos: number }>();
  for (const a of eligible) {
    if (!fanciers.has(a.fancierKey)) {
      fanciers.set(a.fancierKey, { fancierKey: a.fancierKey, birdsScored: 0, points: 0, basketed: a.basketed!, benzingPositions: [], firstPos: Infinity });
    }
  }
  for (const l of lines) {
    const f = fanciers.get(l.fancierKey)!;
    f.birdsScored += 1;
    f.points += l.points;
    f.benzingPositions.push(l.benzingPosition);
    f.firstPos = Math.min(f.firstPos, l.scoringPosition);
  }
  const scored = [...fanciers.values()]
    .map((f) => ({ ...f, score: round2(f.points / f.basketed) }))
    .sort((a, b) => b.score - a.score || a.firstPos - b.firstPos || a.fancierKey.localeCompare(b.fancierKey))
    .map(({ firstPos: _f, ...rest }) => rest);

  return { n, lines, fanciers: scored, excluded };
}
