/**
 * Registry of scoring systems. A competition = one system + its parameters + which races count.
 * To add a new result/point system: implement ScoringSystem and register it in SYSTEMS.
 * Every system takes the same input (the full result, ranked by speed) and returns per-bird
 * points and per-fancier race scores, so storage, publishing, standings and exports work unchanged.
 */
import { calculateRace, type ArrivalInput, type Override, type RaceCalculation } from "./fiveBird";
import { calculateBirdPoints, calculateTopPercent, calculateWins } from "./extraSystems";
import { calculateWeightedRace, parseClosing } from "./weighted";

/** Race facts some systems need beyond the arrivals. */
export interface RaceContext {
  /** Birds basketed in the whole race (Benzing's race total), when known. */
  raceBasketed: number | null;
}

export interface ParamField {
  key: string;
  label: string;
  type: "integer" | "time";
  min?: number;
  max?: number;
  help?: string;
}

/** Thrown when a race needs per-race settings (e.g. a closing time) that the admin has not set yet. */
export class MissingRaceSettings extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingRaceSettings";
  }
}

export interface ScoringSystem<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: string;
  /** What the standings rank: fanciers, or individual birds (by ring). */
  entity: "fancier" | "bird";
  /** Season total: sum of race scores, or a ratio Σ counted ÷ Σ basketed (percent). */
  season: "sum" | "ratio";
  /** Short label for the score column, e.g. "Points", "Wins", "%". */
  unit: string;
  /** Plain-English summary for rules pages, given the parameters. */
  describe(params: P): string;
  fields: ParamField[];
  defaults: P;
  /** Validates untrusted parameters; throws RangeError with a readable message. */
  parse(raw: unknown): P;
  /** Settings the admin sets per race for this competition (e.g. closing time). */
  raceFields?: ParamField[];
  /** Validates per-race settings; throws RangeError with a readable message. */
  parseRace?(raw: unknown): Record<string, unknown>;
  /** Competition-wide default for the per-race settings, if the admin set one. */
  raceDefaults?(params: P): Record<string, unknown> | null;
  /** Throws MissingRaceSettings when raceFields exist but raceParams is null. */
  score(
    arrivals: readonly ArrivalInput[],
    params: P,
    overrides: readonly Override[],
    raceParams?: Record<string, unknown> | null,
    ctx?: RaceContext,
  ): RaceCalculation;
}

function intField(raw: Record<string, unknown>, f: ParamField): number {
  const v = Number(raw[f.key]);
  if (!Number.isInteger(v) || v < f.min! || v > f.max!) throw new RangeError(`${f.label} must be a whole number from ${f.min} to ${f.max}.`);
  return v;
}

const topNFields: ParamField[] = [{ key: "scoringBirds", label: "Scoring birds per fancier", type: "integer", min: 1, max: 50 }];

/** QRPC 5-bird system, generalised: each fancier's first N birds score N_total − position + 1. */
export const topNPerFancier: ScoringSystem<{ scoringBirds: number }> = {
  id: "top-n-per-fancier",
  name: "First N birds per fancier",
  entity: "fancier",
  season: "sum",
  unit: "Points",
  fields: topNFields,
  defaults: { scoringBirds: 5 },
  describe: (p) =>
    `Each fancier's first ${p.scoringBirds} birds home score. Those birds are re-ranked by speed; with N scoring birds the fastest gets N points and the slowest 1.`,
  parse(raw) {
    if (typeof raw !== "object" || raw === null) throw new RangeError("Parameters missing.");
    return { scoringBirds: intField(raw as Record<string, unknown>, topNFields[0]!) };
  },
  score: (arrivals, p, overrides) => calculateRace(arrivals, { scoringBirds: p.scoringBirds }, overrides),
};

/** Weighted by basketing: birds within the closing time score N − position + 1; total ÷ birds basketed. */
const closingFields: ParamField[] = [
  { key: "closingDay", label: "Closing day", type: "integer", min: 1, max: 14, help: "1 = liberation day, 2 = the next day" },
  { key: "closingTime", label: "Closing time (SAST)", type: "time" },
];

/** Default closing (competition-wide): both fields, or neither. */
function parseDefaultClosing(raw: unknown): { closingDay?: number; closingTime?: string } {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const empty = (v: unknown) => v === undefined || v === null || v === "";
  if (empty(r.closingDay) && empty(r.closingTime)) return {};
  if (empty(r.closingDay) || empty(r.closingTime)) throw new RangeError("Set both the default closing day and time, or leave both empty.");
  const c = parseClosing(r);
  return { closingDay: c.day, closingTime: c.time.slice(0, 5) };
}

export const weightedByBasketing: ScoringSystem<{ closingDay?: number; closingTime?: string }> = {
  id: "weighted-by-basketing",
  name: "Weighted by birds basketed (closing time)",
  entity: "fancier",
  season: "sum",
  unit: "Points",
  fields: closingFields.map((f) => ({ ...f, label: `Default ${f.label.charAt(0).toLowerCase()}${f.label.slice(1)}`, help: `${f.help ? `${f.help}. ` : ""}Used for every race unless the race has its own.` })),
  defaults: {},
  raceFields: closingFields,
  describe: () =>
    "Every bird clocked by the race's closing time scores. Those birds are ranked by speed; with N of them the fastest gets N points and the slowest 1. A fancier's race score is their total points divided by the number of birds they basketed.",
  parse: parseDefaultClosing,
  parseRace(raw) {
    const c = parseClosing(raw);
    return { closingDay: c.day, closingTime: c.time.slice(0, 5) };
  },
  raceDefaults: (p) => (p.closingDay !== undefined ? { closingDay: p.closingDay, closingTime: p.closingTime } : null),
  score(arrivals, p, overrides, raceParams) {
    const closing = raceParams ?? (p.closingDay !== undefined ? p : null);
    if (!closing) throw new MissingRaceSettings("Set a default closing time for this competition in Settings, or one for this race.");
    return calculateWeightedRace(arrivals, parseClosing(closing), overrides);
  },
};

/** Best bird: every bird home scores 100 (1st) down to 1 (last); points add up per bird over the season. */
export const birdPoints: ScoringSystem<Record<string, never>> = {
  id: "bird-points",
  name: "Best bird (100 to 1 per race)",
  entity: "bird",
  season: "sum",
  unit: "Points",
  fields: [],
  defaults: {},
  describe: () =>
    "Every bird home scores: the first bird gets 100 points, the last gets 1, and the rest are spaced evenly in between. Points add up per bird over the season.",
  parse: () => ({}),
  score: (arrivals, _p, overrides) => calculateBirdPoints(arrivals, overrides),
};

/** Wins: the fancier with the first bird in the full result gets one win. */
export const wins: ScoringSystem<Record<string, never>> = {
  id: "wins",
  name: "Race wins (first bird)",
  entity: "fancier",
  season: "sum",
  unit: "Wins",
  fields: [],
  defaults: {},
  describe: () => "The fancier who clocks the first bird in the full result wins the race. Wins add up over the season.",
  parse: () => ({}),
  score: (arrivals, _p, overrides) => calculateWins(arrivals, overrides),
};

const percentField: ParamField = { key: "percent", label: "Top % of birds basketed", type: "integer", min: 1, max: 100 };

/** Share of a fancier's basketed birds that finish in the top X % of all birds basketed. */
export const topPercent: ScoringSystem<{ percent: number }> = {
  id: "top-percent",
  name: "Birds in the top X % (of basketed)",
  entity: "fancier",
  season: "ratio",
  unit: "%",
  fields: [percentField],
  defaults: { percent: 25 },
  describe: (p) =>
    `The fastest ${p.percent}% of all birds basketed in a race (rounded down) are counted. A fancier's figure is the share of the birds he basketed that made it: his counted birds ÷ birds basketed. The season figure uses all his birds over the season, not an average of races.`,
  parse(raw) {
    if (typeof raw !== "object" || raw === null) throw new RangeError("Parameters missing.");
    return { percent: intField(raw as Record<string, unknown>, percentField) };
  },
  score(arrivals, p, overrides, _rp, ctx) {
    const fallback = [...new Map(arrivals.map((a) => [a.fancierKey, a.basketed ?? 0])).values()].reduce((s, n) => s + n, 0);
    return calculateTopPercent(arrivals, p.percent, ctx?.raceBasketed ?? fallback, overrides);
  },
};

export const SYSTEMS: Record<string, ScoringSystem> = {
  [topNPerFancier.id]: topNPerFancier as unknown as ScoringSystem,
  [weightedByBasketing.id]: weightedByBasketing as unknown as ScoringSystem,
  [birdPoints.id]: birdPoints as unknown as ScoringSystem,
  [wins.id]: wins as unknown as ScoringSystem,
  [topPercent.id]: topPercent as unknown as ScoringSystem,
};

export function getSystem(id: string): ScoringSystem {
  const s = SYSTEMS[id];
  if (!s) throw new RangeError(`Unknown scoring system "${id}".`);
  return s;
}
