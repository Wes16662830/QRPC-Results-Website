import { describe, expect, it } from "vitest";
import { applyDistanceFactor, distanceFactor, raceAverageM } from "../src/core/scoring/distance";
import type { RaceCalculation } from "../src/core/scoring/fiveBird";

describe("distance weighting", () => {
  it("race average distance", () => {
    expect(raceAverageM(463653, 485647)).toBe(474650);
    expect(raceAverageM(null, 500000)).toBe(500000);
    expect(raceAverageM(300000, null)).toBe(300000);
    expect(raceAverageM(null, null)).toBeNull();
  });

  it("factor = race km ÷ base km to 4 decimals, 1 when unknown", () => {
    expect(distanceFactor(590000, 306000)).toBe(1.9281);
    expect(distanceFactor(306000, 306000)).toBe(1);
    expect(distanceFactor(null, 306000)).toBe(1);
    expect(distanceFactor(590000, null)).toBe(1);
  });

  it("multiplies bird and fancier points, rounded to 2 decimals", () => {
    const calc: RaceCalculation = {
      n: 2,
      lines: [
        { arrivalId: "1", fancierKey: "A", ring: "R1", speedMilli: 2, benzingPosition: 1, scoringPosition: 1, points: 36 },
        { arrivalId: "2", fancierKey: "B", ring: "R2", speedMilli: 1, benzingPosition: 2, scoringPosition: 2, points: 35 },
      ],
      fanciers: [
        { fancierKey: "A", birdsScored: 1, score: 36, benzingPositions: [1] },
        { fancierKey: "B", birdsScored: 1, score: 1.4, points: 35, basketed: 25, benzingPositions: [2] },
      ],
      excluded: [],
    };
    const w = applyDistanceFactor(calc, 1.9281);
    expect(w.lines.map((l) => l.points)).toEqual([69.41, 67.48]);
    expect(w.fanciers.map((f) => [f.score, f.points])).toEqual([[69.41, undefined], [2.7, 67.48]]);
    expect(applyDistanceFactor(calc, 1)).toBe(calc);
  });
});
