import { describe, expect, it } from "vitest";
import { getSystem, SYSTEMS, topNPerFancier } from "../src/core/scoring/systems";

describe("scoring system registry", () => {
  it("registers the top-N system", () => {
    expect(Object.keys(SYSTEMS)).toEqual(["top-n-per-fancier"]);
    expect(getSystem("top-n-per-fancier")).toBe(topNPerFancier);
    expect(() => getSystem("nope")).toThrow(/Unknown scoring system/);
  });

  it("validates parameters", () => {
    expect(topNPerFancier.parse({ scoringBirds: "5" })).toEqual({ scoringBirds: 5 });
    expect(() => topNPerFancier.parse(null)).toThrow(/missing/);
    expect(() => topNPerFancier.parse({ scoringBirds: 0 })).toThrow(/1 to 50/);
    expect(() => topNPerFancier.parse({ scoringBirds: 2.5 })).toThrow(/whole number/);
  });

  it("describes and scores", () => {
    expect(topNPerFancier.describe({ scoringBirds: 5 })).toMatch(/first 5 birds/);
    const r = topNPerFancier.score(
      [{ id: "1", fancierKey: "A", ring: "R1", speedMilli: 2, benzingPosition: 1, listOrder: 1 }],
      { scoringBirds: 5 },
      [],
    );
    expect(r.fanciers).toEqual([{ fancierKey: "A", birdsScored: 1, score: 1, benzingPositions: [1] }]);
  });
});
