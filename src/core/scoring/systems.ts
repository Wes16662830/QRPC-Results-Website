/**
 * Registry of scoring systems. A competition = one system + its parameters + which races count.
 * To add a new result/point system: implement ScoringSystem and register it in SYSTEMS.
 * Every system takes the same input (the full result, ranked by speed) and returns per-bird
 * points and per-fancier race scores, so storage, publishing, standings and exports work unchanged.
 */
import { calculateRace, type ArrivalInput, type Override, type RaceCalculation } from "./fiveBird";
import { calculateWeightedRace, parseClosing } from "./weighted";

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
  /** Throws MissingRaceSettings when raceFields exist but raceParams is null. */
  score(arrivals: readonly ArrivalInput[], params: P, overrides: readonly Override[], raceParams?: Record<string, unknown> | null): RaceCalculation;
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

/** Weighted by basketing: birds within the race's closing time score N − position + 1; total ÷ birds basketed. */
export const weightedByBasketing: ScoringSystem<Record<string, never>> = {
  id: "weighted-by-basketing",
  name: "Weighted by birds basketed (closing time)",
  fields: [],
  defaults: {},
  raceFields: [
    { key: "closingDay", label: "Closing day", type: "integer", min: 1, max: 14, help: "1 = liberation day, 2 = the next day" },
    { key: "closingTime", label: "Closing time (SAST)", type: "time" },
  ],
  describe: () =>
    "Every bird clocked by the race's closing time scores. Those birds are ranked by speed; with N of them the fastest gets N points and the slowest 1. A fancier's race score is their total points divided by the number of birds they basketed.",
  parse: () => ({}),
  parseRace(raw) {
    const c = parseClosing(raw);
    return { closingDay: c.day, closingTime: c.time.slice(0, 5) };
  },
  score(arrivals, _p, overrides, raceParams) {
    if (!raceParams) throw new MissingRaceSettings("Set this race's closing day and time for this competition.");
    return calculateWeightedRace(arrivals, parseClosing(raceParams), overrides);
  },
};

export const SYSTEMS: Record<string, ScoringSystem> = {
  [topNPerFancier.id]: topNPerFancier as unknown as ScoringSystem,
  [weightedByBasketing.id]: weightedByBasketing as unknown as ScoringSystem,
};

export function getSystem(id: string): ScoringSystem {
  const s = SYSTEMS[id];
  if (!s) throw new RangeError(`Unknown scoring system "${id}".`);
  return s;
}
