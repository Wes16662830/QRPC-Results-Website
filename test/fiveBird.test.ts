import { describe, expect, it } from "vitest";
import { calculateRace, calculateSeason, type ArrivalInput } from "../src/core/scoring/fiveBird";

let seq = 0;
function bird(fancierKey: string, speed: number, extra: Partial<ArrivalInput> = {}): ArrivalInput {
  seq += 1;
  return { id: `a${seq}`, fancierKey, ring: `R${seq}`, speedMilli: speed, benzingPosition: seq, listOrder: seq, ...extra };
}

describe("calculateRace", () => {
  it("scores N − position + 1 and keeps only the first X birds per fancier", () => {
    const arrivals = [bird("A", 1500), bird("A", 1400), bird("B", 1300), bird("A", 1200), bird("B", 1100)];
    const r = calculateRace(arrivals, { scoringBirds: 2 });
    expect(r.n).toBe(4);
    expect(r.lines.map((l) => [l.fancierKey, l.scoringPosition, l.points])).toEqual([
      ["A", 1, 4], ["A", 2, 3], ["B", 3, 2], ["B", 4, 1],
    ]);
    expect(r.fanciers.map((f) => [f.fancierKey, f.score, f.birdsScored])).toEqual([["A", 7, 2], ["B", 3, 2]]);
  });

  it("re-sorts by speed even if input is out of order", () => {
    const slow = bird("A", 1000);
    const fast = bird("B", 2000);
    const r = calculateRace([slow, fast], { scoringBirds: 5 });
    expect(r.lines.map((l) => l.fancierKey)).toEqual(["B", "A"]);
  });

  it("never shares positions: exact speed ties follow Benzing listing order", () => {
    const x = bird("X", 1500, { benzingPosition: 1, listOrder: 2 });
    const y = bird("Y", 1500, { benzingPosition: 1, listOrder: 1 });
    const r = calculateRace([x, y], { scoringBirds: 5 });
    expect(r.lines.map((l) => [l.fancierKey, l.scoringPosition, l.points])).toEqual([["Y", 1, 2], ["X", 2, 1]]);
  });

  it("orders fanciers on equal scores by their best scoring bird", () => {
    // A: positions 1 + 4 = 4+1 = 5 ; B: positions 2 + 3 = 3+2 = 5
    const r = calculateRace([bird("A", 40), bird("B", 30), bird("B", 20), bird("A", 10)], { scoringBirds: 5 });
    expect(r.fanciers.map((f) => [f.fancierKey, f.score])).toEqual([["A", 5], ["B", 5]]);
  });

  it("disqualified bird is removed before selection, so the fancier's next bird moves up", () => {
    const a1 = bird("A", 300);
    const r = calculateRace([a1, bird("A", 200), bird("A", 100)], { scoringBirds: 2 }, [
      { scope: "bird", target: a1.ring, reason: "clocking fault" },
    ]);
    expect(r.lines.map((l) => l.speedMilli)).toEqual([200, 100]);
    expect(r.excluded).toEqual([{ arrivalId: a1.id, reason: "clocking fault" }]);
  });

  it("disqualified fancier loses all birds and N shrinks", () => {
    const r = calculateRace([bird("A", 300), bird("B", 200), bird("A", 100)], { scoringBirds: 5 }, [
      { scope: "fancier", target: "A", reason: "late basketing" },
    ]);
    expect(r.n).toBe(1);
    expect(r.fanciers).toEqual([{ fancierKey: "B", birdsScored: 1, score: 1, benzingPositions: [expect.any(Number)] }]);
    expect(r.excluded).toHaveLength(2);
  });

  it("handles an empty race", () => {
    expect(calculateRace([], { scoringBirds: 5 })).toEqual({ n: 0, lines: [], fanciers: [], excluded: [] });
  });

  it("rejects bad settings and inputs", () => {
    expect(() => calculateRace([], { scoringBirds: 0 })).toThrow(RangeError);
    expect(() => calculateRace([], { scoringBirds: 2.5 })).toThrow(RangeError);
    expect(() => calculateRace([bird("A", 1.5)], { scoringBirds: 5 })).toThrow(/speed/);
    expect(() => calculateRace([bird("A", -1)], { scoringBirds: 5 })).toThrow(/speed/);
    expect(() => calculateRace([bird("A", 1, { listOrder: 0.5 })], { scoringBirds: 5 })).toThrow(/listOrder/);
    const b = bird("A", 1);
    expect(() => calculateRace([b, { ...b }], { scoringBirds: 5 })).toThrow(/Duplicate/);
  });
});

describe("calculateSeason", () => {
  const races = [
    { raceId: "r1", scores: [{ fancierKey: "A", score: 10 }, { fancierKey: "B", score: 30 }] },
    { raceId: "r2", scores: [{ fancierKey: "A", score: 50 }] },
    { raceId: "r3", scores: [{ fancierKey: "A", score: 20 }, { fancierKey: "B", score: 40 }] },
  ];

  it("sums all races, absent = 0", () => {
    const s = calculateSeason(races, { racesCounted: "all" });
    expect(s.map((x) => [x.fancierKey, x.total, x.rank])).toEqual([["A", 80, 1], ["B", 70, 2]]);
    expect(s[1]!.perRace).toEqual({ r1: 30, r2: 0, r3: 40 });
    expect(s[1]!.countedRaceIds).toEqual(["r1", "r2", "r3"]);
  });

  it("counts best X of Y", () => {
    const s = calculateSeason(races, { racesCounted: { best: 1 } });
    expect(s.map((x) => [x.fancierKey, x.total, x.countedRaceIds])).toEqual([["A", 50, ["r2"]], ["B", 40, ["r3"]]]);
  });

  it("gives equal totals a shared rank", () => {
    const s = calculateSeason(
      [{ raceId: "r1", scores: [{ fancierKey: "B", score: 5 }, { fancierKey: "A", score: 5 }, { fancierKey: "C", score: 1 }] }],
      { racesCounted: "all" },
    );
    expect(s.map((x) => [x.fancierKey, x.rank])).toEqual([["A", 1], ["B", 1], ["C", 3]]);
  });

  it("rejects bad best-X", () => {
    expect(() => calculateSeason(races, { racesCounted: { best: 0 } })).toThrow(RangeError);
  });
});
