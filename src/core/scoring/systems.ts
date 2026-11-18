/**
 * Registry of scoring systems. A competition = one system + its parameters + which races count.
 * To add a new result/point system: implement ScoringSystem and register it in SYSTEMS.
 * Every system takes the same input (the full result, ranked by speed) and returns per-bird
 * points and per-fancier race scores, so storage, publishing, standings and exports work unchanged.
 */
import { calculateRace, type ArrivalInput, type Override, type RaceCalculation } from "./fiveBird";

export interface ParamField {
  key: string;
  label: string;
  type: "integer";
  min: number;
  max: number;
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
  score(arrivals: readonly ArrivalInput[], params: P, overrides: readonly Override[]): RaceCalculation;
}

function intField(raw: Record<string, unknown>, f: ParamField): number {
  const v = Number(raw[f.key]);
  if (!Number.isInteger(v) || v < f.min || v > f.max) throw new RangeError(`${f.label} must be a whole number from ${f.min} to ${f.max}.`);
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

export const SYSTEMS: Record<string, ScoringSystem> = {
  [topNPerFancier.id]: topNPerFancier as unknown as ScoringSystem,
};

export function getSystem(id: string): ScoringSystem {
  const s = SYSTEMS[id];
  if (!s) throw new RangeError(`Unknown scoring system "${id}".`);
  return s;
}
