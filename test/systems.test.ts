import { describe, expect, it } from "vitest";
import { baseBirdPoints, getSystem, SYSTEMS, topNPerFancier, usesBaseRace, wins } from "../src/core/scoring/systems";

describe("scoring system registry", () => {
  it("registers the top-N system", () => {
    expect(Object.keys(SYSTEMS)).toEqual(["top-n-per-fancier", "weighted-by-basketing", "bird-points-base", "bird-points", "wins", "top-percent"]);
    expect(getSystem("top-n-per-fancier")).toBe(topNPerFancier);
    expect(() => getSystem("nope")).toThrow(/Unknown scoring system/);
  });

  it("validates parameters", () => {
    expect(topNPerFancier.parse({ scoringBirds: "5" })).toEqual({ scoringBirds: 5, scale: "race" });
    expect(topNPerFancier.parse({ scoringBirds: 5, scale: "first-race" })).toEqual({ scoringBirds: 5, scale: "first-race" });
    expect(topNPerFancier.parse({ scoringBirds: 5, scale: "" })).toEqual({ scoringBirds: 5, scale: "race" });
    expect(() => topNPerFancier.parse({ scoringBirds: 5, scale: "x" })).toThrow(/Points scale/);
    expect(() => topNPerFancier.parse(null)).toThrow(/missing/);
    expect(() => topNPerFancier.parse({ scoringBirds: 0 })).toThrow(/1 to 50/);
    expect(() => topNPerFancier.parse({ scoringBirds: 2.5 })).toThrow(/whole number/);
  });

  it("describes and scores, on each race's own scale or the first race's", () => {
    expect(topNPerFancier.describe({ scoringBirds: 5, scale: "race" })).toMatch(/first 5 birds/);
    expect(topNPerFancier.describe({ scoringBirds: 5, scale: "first-race" })).toMatch(/first race sets the points/);
    const one = [{ id: "1", fancierKey: "A", ring: "R1", speedMilli: 2, benzingPosition: 1, listOrder: 1 }];
    const r = topNPerFancier.score(one, { scoringBirds: 5, scale: "race" }, []);
    expect(r.fanciers).toEqual([{ fancierKey: "A", birdsScored: 1, score: 1, benzingPositions: [1] }]);
    expect(topNPerFancier.score(one, { scoringBirds: 5, scale: "first-race" }, [], null, { raceBasketed: null, baseBirds: 36 }).fanciers[0]!.score).toBe(36);
    // Until the first race has results, a race uses its own size.
    expect(topNPerFancier.score(one, { scoringBirds: 5, scale: "first-race" }, [], null, { raceBasketed: null, baseBirds: null }).fanciers[0]!.score).toBe(1);
    expect(usesBaseRace(topNPerFancier as never, { scale: "first-race" })).toBe(true);
    expect(usesBaseRace(topNPerFancier as never, { scale: "race" })).toBe(false);
    expect(usesBaseRace(baseBirdPoints as never, {})).toBe(true);
    expect(usesBaseRace(wins as never, {})).toBe(false);
  });
});
