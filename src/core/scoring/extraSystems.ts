/**
 * Further competitions agreed with Wes (18 Nov 2026). Pure functions, no I/O.
 *
 *  Bird points (best overall / short / middle / long bird):
 *    every bird home scores; with N birds, position p (1..N, speed order, exact ties keep Benzing's
 *    listing order) earns 1 + 99 × (N − p) ÷ (N − 1), rounded to 2 decimals (1st = 100, last = 1;
 *    a single bird gets 100). Season: points add up per BIRD (ring).
 *
 *  Wins: the fancier with the first bird in the full result (after disqualifications) gets 1 win.
 *
 *  Top X % of basketed: the fastest floor(X % × birds basketed in the race) birds count. A fancier's
 *    race figure = his counted birds ÷ birds he basketed × 100. Season = Σ counted ÷ Σ basketed × 100.
 */
import type { ArrivalInput, FancierRaceScore, Override, RaceCalculation, ScoringLine } from "./fiveBird";

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Validation and disqualifications shared by the systems below. Returns eligible birds in speed order. */
export function rankEligible(arrivals: readonly ArrivalInput[], overrides: readonly Override[], needBasketed: boolean) {
  const ids = new Set<string>();
  for (const a of arrivals) {
    if (!Number.isInteger(a.speedMilli) || a.speedMilli < 0) throw new RangeError(`Invalid speed for arrival ${a.id}`);
    if (!Number.isInteger(a.listOrder)) throw new RangeError(`Invalid listOrder for arrival ${a.id}`);
    if (needBasketed && (!Number.isInteger(a.basketed) || a.basketed! < 1)) throw new RangeError(`Arrival ${a.id} has no basketed count`);
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
  eligible.sort((x, y) => y.speedMilli - x.speedMilli || x.listOrder - y.listOrder);
  return { eligible, excluded };
}

const line = (a: ArrivalInput, position: number, points: number): ScoringLine => ({
  arrivalId: a.id,
  fancierKey: a.fancierKey,
  ring: a.ring,
  speedMilli: a.speedMilli,
  benzingPosition: a.benzingPosition,
  scoringPosition: position,
  points,
});

/** Fancier totals from lines; every fancier with an eligible bird is listed (0 if none scored). */
function fancierTotals(
  eligible: readonly ArrivalInput[],
  lines: readonly ScoringLine[],
  score: (points: number, basketed: number) => number,
  usesBasketed = false,
): FancierRaceScore[] {
  const map = new Map<string, FancierRaceScore & { first: number }>();
  for (const a of eligible) {
    if (!map.has(a.fancierKey)) {
      map.set(a.fancierKey, { fancierKey: a.fancierKey, birdsScored: 0, score: 0, points: 0, ...(usesBasketed ? { basketed: a.basketed } : {}), benzingPositions: [], first: Infinity });
    }
  }
  for (const l of lines) {
    const f = map.get(l.fancierKey)!;
    f.birdsScored += 1;
    f.points = round2(f.points! + l.points);
    f.benzingPositions.push(l.benzingPosition);
    f.first = Math.min(f.first, l.scoringPosition);
  }
  return [...map.values()]
    .map((f) => ({ ...f, score: score(f.points!, f.basketed ?? 1) }))
    .sort((a, b) => b.score - a.score || a.first - b.first || a.fancierKey.localeCompare(b.fancierKey))
    .map(({ first: _f, ...rest }) => rest);
}

/** 1st = 100, last = 1, evenly spaced; a lone bird gets 100. */
export function percentPoints(n: number, position: number): number {
  if (n === 1) return 100;
  return round2(1 + (99 * (n - position)) / (n - 1));
}

export function calculateBirdPoints(arrivals: readonly ArrivalInput[], overrides: readonly Override[] = []): RaceCalculation {
  const { eligible, excluded } = rankEligible(arrivals, overrides, false);
  const n = eligible.length;
  const lines = eligible.map((a, i) => line(a, i + 1, percentPoints(n, i + 1)));
  return { n, lines, fanciers: fancierTotals(eligible, lines, (p) => p), excluded };
}

/**
 * Best bird with the season's first race as the base: if B birds came home in the base race,
 * place p scores B − p + 1 in every race (1st = B … Bth = 1); places below B score 0 and are left out.
 */
export function calculateBaseBirdPoints(arrivals: readonly ArrivalInput[], baseBirds: number, overrides: readonly Override[] = []): RaceCalculation {
  if (!Number.isInteger(baseBirds) || baseBirds < 1) throw new RangeError("Base race bird count is missing.");
  const { eligible, excluded } = rankEligible(arrivals, overrides, false);
  const lines = eligible.slice(0, baseBirds).map((a, i) => line(a, i + 1, baseBirds - i));
  return { n: lines.length, lines, fanciers: fancierTotals(eligible, lines, (p) => p), excluded };
}

export function calculateWins(arrivals: readonly ArrivalInput[], overrides: readonly Override[] = []): RaceCalculation {
  const { eligible, excluded } = rankEligible(arrivals, overrides, false);
  const lines = eligible.length ? [line(eligible[0]!, 1, 1)] : [];
  return { n: lines.length, lines, fanciers: fancierTotals(eligible, lines, (p) => p), excluded };
}

export function calculateTopPercent(arrivals: readonly ArrivalInput[], percent: number, raceBasketed: number, overrides: readonly Override[] = []): RaceCalculation {
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new RangeError("Percentage must be between 1 and 100.");
  if (!Number.isInteger(raceBasketed) || raceBasketed < 0) throw new RangeError("Race basketed count is missing.");
  const { eligible, excluded } = rankEligible(arrivals, overrides, true);
  const k = Math.floor((raceBasketed * percent) / 100);
  const lines = eligible.slice(0, k).map((a, i) => line(a, i + 1, 1));
  return { n: lines.length, lines, fanciers: fancierTotals(eligible, lines, (p, b) => round2((p / b) * 100), true), excluded };
}

/** Season figure for ratio competitions: Σ counted ÷ Σ basketed × 100 (not an average of race %). */
export function ratioSeason(races: readonly { raceId: string; scores: readonly { fancierKey: string; points: number; basketed: number }[] }[]) {
  const totals = new Map<string, { points: number; basketed: number; perRace: Record<string, number> }>();
  for (const r of races) {
    for (const s of r.scores) {
      const t = totals.get(s.fancierKey) ?? { points: 0, basketed: 0, perRace: {} };
      t.points += s.points;
      t.basketed += s.basketed;
      t.perRace[r.raceId] = s.basketed ? round2((s.points / s.basketed) * 100) : 0;
      totals.set(s.fancierKey, t);
    }
  }
  const out = [...totals].map(([fancierKey, t]) => ({
    fancierKey,
    total: t.basketed ? round2((t.points / t.basketed) * 100) : 0,
    points: t.points,
    basketed: t.basketed,
    perRace: t.perRace,
    countedRaceIds: races.filter((r) => t.perRace[r.raceId] !== undefined).map((r) => r.raceId),
    rank: 0,
  }));
  out.sort((a, b) => b.total - a.total || b.points - a.points || a.fancierKey.localeCompare(b.fancierKey));
  out.forEach((s, i) => {
    const prev = out[i - 1];
    s.rank = prev && prev.total === s.total ? prev.rank : i + 1;
  });
  return out;
}
