/**
 * QRPC 5-bird championship engine. Pure functions, no I/O.
 *
 * Race rules (agreed 18 Nov 2026):
 *  1. Start from every arrival on Benzing's full result sheet; Benzing's own points are ignored.
 *  2. Remove disqualified birds/fanciers (admin overrides).
 *  3. Order by speed, highest first. Exactly equal speeds keep Benzing's listing order, so no
 *     two scoring birds ever share a position (TIEBREAK RULE PENDING CLUB DECISION).
 *  4. Keep each fancier's first `scoringBirds` birds, however late they arrive. Drop the rest.
 *  5. N = number of scoring birds. Scoring position p = 1..N. Points = N − p + 1.
 *  6. A fancier's race score is the sum of their scoring birds' points.
 */

export interface ArrivalInput {
  /** Stable id of the arrival (DB id, or ring for fixtures). */
  id: string;
  fancierKey: string;
  ring: string;
  /** m/min × 1000, integer. */
  speedMilli: number;
  /** Benzing's displayed rank (equal speeds share it). Reported only. */
  benzingPosition: number;
  /** Row order on Benzing's sheet; breaks exact speed ties so no positions are shared. */
  listOrder: number;
  /** Day of the race the bird arrived on (1 = liberation day). Needed by cutoff-based systems. */
  arrivalDay?: number;
  /** Local clock time "HH:MM:SS" (SAST). Needed by cutoff-based systems. */
  arrivalTime?: string;
  /** Birds this fancier basketed for the race. Needed by basketing-weighted systems. */
  basketed?: number;
}

export interface Override {
  scope: "bird" | "fancier";
  /** Ring for scope "bird", fancierKey for scope "fancier". */
  target: string;
  reason: string;
}

export interface RaceSettings {
  scoringBirds: number;
  /**
   * Fixed scale (agreed 18 Nov 2026 for the 5-bird championship): N from the season's first race. Scoring
   * position p then earns baseN − p + 1 in every race; scoring birds placed beyond baseN earn 0. Omit for
   * the original rule (N = scoring birds in this race).
   */
  baseN?: number;
}

export interface ScoringLine {
  arrivalId: string;
  fancierKey: string;
  ring: string;
  speedMilli: number;
  benzingPosition: number;
  scoringPosition: number;
  points: number;
}

export interface FancierRaceScore {
  fancierKey: string;
  birdsScored: number;
  score: number;
  /** Benzing positions of the scoring birds, in order. */
  benzingPositions: number[];
  /** Weighted systems only: points before weighting, and the divisor used. */
  points?: number;
  basketed?: number;
}

export interface RaceCalculation {
  n: number;
  lines: ScoringLine[];
  /** Highest score first; equal scores ordered by best (lowest) first scoring position. */
  fanciers: FancierRaceScore[];
  excluded: { arrivalId: string; reason: string }[];
}

export function calculateRace(
  arrivals: readonly ArrivalInput[],
  settings: RaceSettings,
  overrides: readonly Override[] = [],
): RaceCalculation {
  if (!Number.isInteger(settings.scoringBirds) || settings.scoringBirds < 1) {
    throw new RangeError("scoringBirds must be a positive integer");
  }
  if (settings.baseN !== undefined && (!Number.isInteger(settings.baseN) || settings.baseN < 1)) {
    throw new RangeError("baseN must be a positive integer");
  }
  const ids = new Set<string>();
  for (const a of arrivals) {
    if (!Number.isInteger(a.speedMilli) || a.speedMilli < 0) {
      throw new RangeError(`Invalid speed for arrival ${a.id}`);
    }
    if (!Number.isInteger(a.listOrder)) throw new RangeError(`Invalid listOrder for arrival ${a.id}`);
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

  const ordered = [...eligible].sort(
    (x, y) => y.speedMilli - x.speedMilli || x.listOrder - y.listOrder,
  );

  const taken = new Map<string, number>();
  const scoring = ordered.filter((a) => {
    const count = taken.get(a.fancierKey) ?? 0;
    if (count >= settings.scoringBirds) return false;
    taken.set(a.fancierKey, count + 1);
    return true;
  });

  const top = settings.baseN === undefined ? scoring.length : settings.baseN;
  const counted = scoring.slice(0, top);
  const n = counted.length;
  const lines: ScoringLine[] = counted.map((a, i) => ({
    arrivalId: a.id,
    fancierKey: a.fancierKey,
    ring: a.ring,
    speedMilli: a.speedMilli,
    benzingPosition: a.benzingPosition,
    scoringPosition: i + 1,
    points: top - i,
  }));

  const byFancier = new Map<string, FancierRaceScore & { firstPos: number }>();
  for (const l of lines) {
    let f = byFancier.get(l.fancierKey);
    if (!f) {
      f = { fancierKey: l.fancierKey, birdsScored: 0, score: 0, benzingPositions: [], firstPos: l.scoringPosition };
      byFancier.set(l.fancierKey, f);
    }
    f.birdsScored += 1;
    f.score += l.points;
    f.benzingPositions.push(l.benzingPosition);
  }
  const fanciers = [...byFancier.values()]
    .sort((a, b) => b.score - a.score || a.firstPos - b.firstPos)
    .map(({ firstPos: _firstPos, ...rest }) => rest);

  return { n, lines, fanciers, excluded };
}

export interface SeasonSettings {
  /** "all" counts every included race; otherwise the best X race scores per fancier count. */
  racesCounted: "all" | { best: number };
}

export interface SeasonRaceInput {
  raceId: string;
  /** Published race scores only. A fancier absent from a race scores 0 there. */
  scores: readonly { fancierKey: string; score: number }[];
}

export interface SeasonStanding {
  fancierKey: string;
  total: number;
  /** Shared rank for equal totals (1, 1, 3). See open question in docs/phase-1-plan.md. */
  rank: number;
  perRace: Record<string, number>;
  countedRaceIds: string[];
}

export function calculateSeason(races: readonly SeasonRaceInput[], settings: SeasonSettings): SeasonStanding[] {
  if (settings.racesCounted !== "all") {
    const best = settings.racesCounted.best;
    if (!Number.isInteger(best) || best < 1) throw new RangeError("best must be a positive integer");
  }
  const fancierKeys = new Set(races.flatMap((r) => r.scores.map((s) => s.fancierKey)));

  const standings = [...fancierKeys].map((fancierKey) => {
    const perRace: Record<string, number> = {};
    for (const r of races) perRace[r.raceId] = r.scores.find((s) => s.fancierKey === fancierKey)?.score ?? 0;

    // Stable: highest score first, earlier race first on equal scores.
    const ranked = races.map((r) => r.raceId).sort((a, b) => perRace[b]! - perRace[a]!);
    const counted =
      settings.racesCounted === "all" ? ranked : ranked.slice(0, settings.racesCounted.best);
    const countedSet = new Set(counted);
    const countedRaceIds = races.map((r) => r.raceId).filter((id) => countedSet.has(id));
    // Rounded to 2 decimals so fractional (weighted) race scores add up exactly as displayed.
    const total = Math.round(countedRaceIds.reduce((s, id) => s + perRace[id]!, 0) * 100) / 100;
    return { fancierKey, total, rank: 0, perRace, countedRaceIds };
  });

  standings.sort((a, b) => b.total - a.total || a.fancierKey.localeCompare(b.fancierKey));
  standings.forEach((s, i) => {
    const prev = standings[i - 1];
    s.rank = prev && prev.total === s.total ? prev.rank : i + 1;
  });
  return standings;
}
