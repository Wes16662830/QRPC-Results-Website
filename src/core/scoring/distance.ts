/**
 * Distance weighting (agreed with Wes, 19 Nov 2026): every point in a race is multiplied by
 * race km ÷ the competition's first race km this season, using each race's average distance
 * (halfway between its shortest and longest loft). Points are rounded to 2 decimals.
 */
import type { RaceCalculation } from "./fiveBird";

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Average race distance in metres, or null when Benzing gave none. */
export function raceAverageM(minM: number | null, maxM: number | null): number | null {
  if (!minM && !maxM) return null;
  if (!minM) return maxM;
  if (!maxM) return minM;
  return (minM + maxM) / 2;
}

/** Race km ÷ base km, to 4 decimals; 1 when either distance is unknown. */
export function distanceFactor(raceM: number | null, baseM: number | null): number {
  if (!raceM || !baseM) return 1;
  return Math.round((raceM / baseM) * 10000) / 10000;
}

/** Multiplies every bird's and fancier's points by the factor. */
export function applyDistanceFactor<T extends RaceCalculation>(calc: T, factor: number): T {
  if (factor === 1) return calc;
  return {
    ...calc,
    lines: calc.lines.map((l) => ({ ...l, points: round2(l.points * factor) })),
    fanciers: calc.fanciers.map((f) => ({
      ...f,
      score: round2(f.score * factor),
      ...(f.points !== undefined ? { points: round2(f.points * factor) } : {}),
    })),
  };
}
