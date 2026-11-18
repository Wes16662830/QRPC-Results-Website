import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseResultPage } from "../src/core/benzing/parseResultPage";
import { calculateBaseBirdPoints, calculateBirdPoints, calculateTopPercent, calculateWins, percentPoints, ratioSeason } from "../src/core/scoring/extraSystems";
import type { ArrivalInput } from "../src/core/scoring/fiveBird";
import { baseBirdPoints, birdPoints, topPercent, wins } from "../src/core/scoring/systems";

let seq = 0;
const bird = (fancierKey: string, speed: number, basketed = 4, extra: Partial<ArrivalInput> = {}): ArrivalInput => {
  seq += 1;
  return { id: `x${seq}`, fancierKey, ring: `R${seq}`, speedMilli: speed, benzingPosition: seq, listOrder: seq, basketed, ...extra };
};

const mooi = (() => {
  const p = parseResultPage(readFileSync(new URL("../fixtures/benzing/r-6975-t-17084-mooiriver.html", import.meta.url), "utf8"));
  return p.arrivals.map((a) => ({ id: String(a.listOrder), fancierKey: a.fancierName, ring: a.ring, speedMilli: a.speedMilli, benzingPosition: a.position, listOrder: a.listOrder, basketed: a.loftBasketed }));
})();

describe("bird points (100 → 1)", () => {
  it("spaces points evenly from 100 to 1", () => {
    expect(percentPoints(1, 1)).toBe(100);
    expect(percentPoints(2, 1)).toBe(100);
    expect(percentPoints(2, 2)).toBe(1);
    expect(percentPoints(3, 2)).toBe(50.5);
    const r = calculateBirdPoints([bird("A", 10), bird("B", 30), bird("A", 20)]);
    expect(r.lines.map((l) => [l.fancierKey, l.points])).toEqual([["B", 100], ["A", 50.5], ["A", 1]]);
    expect(r.fanciers.map((f) => [f.fancierKey, f.score, f.basketed])).toEqual([["A", 51.5, undefined], ["B", 100, undefined]].sort((x, y) => (y[1] as number) - (x[1] as number)));
  });

  it("Mooi River: 265 birds, first 100, second 99.63, last 1", () => {
    const r = calculateBirdPoints(mooi);
    expect(r.n).toBe(265);
    expect(r.lines[0]).toMatchObject({ ring: "ZA-2025-BORD-3404", points: 100 });
    expect(r.lines[1]!.points).toBe(99.63);
    expect(r.lines.at(-1)).toMatchObject({ ring: "ZA-2025-BORD-2541", points: 1 });
  });

  it("disqualified birds are removed and others move up", () => {
    const a = bird("A", 30);
    const r = calculateBirdPoints([a, bird("B", 20), bird("C", 10)], [{ scope: "bird", target: a.ring, reason: "x" }]);
    expect(r.lines.map((l) => [l.fancierKey, l.points])).toEqual([["B", 100], ["C", 1]]);
    expect(r.excluded).toHaveLength(1);
    const f = calculateBirdPoints([bird("A", 30), bird("B", 20)], [{ scope: "fancier", target: "A", reason: "x" }]);
    expect(f.lines.map((l) => l.fancierKey)).toEqual(["B"]);
  });

  it("validates input", () => {
    expect(() => calculateBirdPoints([bird("A", -1)])).toThrow(/speed/);
    expect(() => calculateBirdPoints([bird("A", 1, 4, { listOrder: 0.5 })])).toThrow(/listOrder/);
    const b = bird("A", 1);
    expect(() => calculateBirdPoints([b, { ...b }])).toThrow(/Duplicate/);
    expect(calculateBirdPoints([])).toEqual({ n: 0, lines: [], fanciers: [], excluded: [] });
  });
});

describe("bird points, first race as the base", () => {
  it("place p scores B − p + 1 in every race; places below B score 0", () => {
    const r = calculateBaseBirdPoints([bird("A", 30), bird("B", 20), bird("C", 10)], 5);
    expect(r.lines.map((l) => [l.fancierKey, l.points])).toEqual([["A", 5], ["B", 4], ["C", 3]]);
    const big = calculateBaseBirdPoints([bird("A", 30), bird("B", 20), bird("C", 10)], 2);
    expect(big.lines.map((l) => l.points)).toEqual([2, 1]); // C is placed below B = 2: 0, left out
    expect(big.fanciers.find((f) => f.fancierKey === "C")).toMatchObject({ score: 0, birdsScored: 0 });
    expect(() => calculateBaseBirdPoints([], 0)).toThrow(/Base race/);
  });

  it("Mooi River scored with Matatiele 1 (322 home) as the base", () => {
    const r = calculateBaseBirdPoints(mooi, 322);
    expect([r.lines[0]!.points, r.lines[9]!.points, r.lines.at(-1)!.points]).toEqual([322, 313, 58]);
  });

  it("system wrapper uses the base, or the race itself until the base has results", () => {
    expect(baseBirdPoints.usesBaseRace).toBe(true);
    expect(baseBirdPoints.parse({})).toEqual({});
    expect(baseBirdPoints.describe({})).toMatch(/first race/);
    expect(baseBirdPoints.score(mooi, {}, [], null, { raceBasketed: null, baseBirds: 322 }).lines[0]!.points).toBe(322);
    expect(baseBirdPoints.score(mooi, {}, []).lines[0]!.points).toBe(265);
    expect(baseBirdPoints.score([], {}, []).n).toBe(0);
  });
});

describe("wins", () => {
  it("first bird wins; others listed with 0; disqualified first bird passes the win on", () => {
    const r = calculateWins(mooi);
    expect(r.fanciers[0]).toMatchObject({ fancierKey: "Wesley Phillips", score: 1 });
    expect(r.fanciers.filter((f) => f.score === 0)).toHaveLength(6);
    const first = bird("A", 30);
    const dq = calculateWins([first, bird("B", 20)], [{ scope: "bird", target: first.ring, reason: "x" }]);
    expect(dq.fanciers.map((f) => [f.fancierKey, f.score])).toEqual([["B", 1]]);
    expect(calculateWins([]).n).toBe(0);
  });
});

describe("top X % of basketed", () => {
  it("Mooi River: top 25 % of 372 basketed = 93 birds", () => {
    const r = calculateTopPercent(mooi, 25, 372);
    expect(r.n).toBe(93);
    expect(r.fanciers.map((f) => [f.fancierKey, f.points, f.basketed, f.score])).toEqual([
      ["Scott King", 30, 83, 36.14],
      ["Larry Elliott", 16, 47, 34.04],
      ["Glenn Mcewan", 21, 65, 32.31],
      ["Wesley Phillips", 17, 74, 22.97],
      ["Theuns Van Schalkwyk", 7, 31, 22.58],
      ["Albert Venter", 2, 47, 4.26],
      ["Willie du Plessis", 0, 25, 0],
    ]);
  });

  it("rounds the count down and validates", () => {
    expect(calculateTopPercent([bird("A", 3, 2), bird("B", 2, 5), bird("A", 1, 2)], 25, 7).n).toBe(1);
    expect(() => calculateTopPercent([], 0, 10)).toThrow(/Percentage/);
    expect(() => calculateTopPercent([], 101, 10)).toThrow(/Percentage/);
    expect(() => calculateTopPercent([], 25, -1)).toThrow(/basketed/);
    expect(() => calculateTopPercent([bird("A", 1, 0)], 25, 4)).toThrow(/basketed count/);
  });

  it("season figure is Σ counted ÷ Σ basketed, not an average of races", () => {
    const s = ratioSeason([
      { raceId: "r1", scores: [{ fancierKey: "A", points: 2, basketed: 2 }, { fancierKey: "B", points: 1, basketed: 10 }] },
      { raceId: "r2", scores: [{ fancierKey: "A", points: 0, basketed: 20 }, { fancierKey: "B", points: 5, basketed: 10 }, { fancierKey: "C", points: 0, basketed: 0 }] },
    ]);
    // A: 2/22 = 9.09 % (average of races would be 50 %); B: 6/20 = 30 %.
    expect(s.map((x) => [x.fancierKey, x.total, x.rank])).toEqual([["B", 30, 1], ["A", 9.09, 2], ["C", 0, 3]]);
    expect(s[1]!.perRace).toEqual({ r1: 100, r2: 0 });
    expect(s[0]!.countedRaceIds).toEqual(["r1", "r2"]);
    const tie = ratioSeason([{ raceId: "r", scores: [{ fancierKey: "X", points: 1, basketed: 2 }, { fancierKey: "Y", points: 1, basketed: 2 }] }]);
    expect(tie.map((x) => x.rank)).toEqual([1, 1]);
  });
});

describe("registered systems", () => {
  it("describe, parse and score", () => {
    expect(birdPoints.entity).toBe("bird");
    expect(birdPoints.describe({})).toMatch(/100 points/);
    expect(birdPoints.parse({})).toEqual({});
    expect(birdPoints.score(mooi, {}, []).n).toBe(265);
    expect(wins.describe({})).toMatch(/first bird/);
    expect(wins.parse({})).toEqual({});
    expect(wins.score(mooi, {}, []).n).toBe(1);
    expect(topPercent.season).toBe("ratio");
    expect(topPercent.describe({ percent: 25 })).toMatch(/25%/);
    expect(topPercent.parse({ percent: "20" })).toEqual({ percent: 20 });
    expect(() => topPercent.parse(null)).toThrow(/missing/);
    expect(topPercent.score(mooi, { percent: 25 }, [], null, { raceBasketed: 372 }).n).toBe(93);
    // Without the race total, falls back to the sum of the fanciers' basketed counts (372 here too).
    expect(topPercent.score(mooi, { percent: 25 }, []).n).toBe(93);
    expect(() => topPercent.score([bird("A", 1, 4, { basketed: undefined })], { percent: 25 }, [])).toThrow(/basketed count/);
  });
});
