import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseResultPage } from "../src/core/benzing/parseResultPage";
import type { ArrivalInput } from "../src/core/scoring/fiveBird";
import { MissingRaceSettings, weightedByBasketing } from "../src/core/scoring/systems";
import { calculateWeightedRace, parseClosing } from "../src/core/scoring/weighted";

let seq = 0;
const bird = (fancierKey: string, speed: number, day: number, time: string, basketed: number, extra: Partial<ArrivalInput> = {}): ArrivalInput => {
  seq += 1;
  return { id: `w${seq}`, fancierKey, ring: `R${seq}`, speedMilli: speed, benzingPosition: seq, listOrder: seq, arrivalDay: day, arrivalTime: time, basketed, ...extra };
};
const DAY1_18 = { day: 1, time: "18:00:00" };

describe("weighted by basketing", () => {
  it("scores birds up to and including the closing time, N − position + 1, divided by birds basketed", () => {
    const r = calculateWeightedRace(
      [
        bird("A", 1500, 1, "12:00:00", 10),
        bird("B", 1400, 1, "12:10:00", 2),
        bird("A", 1300, 1, "18:00:00", 10), // exactly on closing: counts
        bird("B", 1200, 1, "18:00:01", 2), // one second late: no points
        bird("C", 900, 2, "07:00:00", 4), // day 2: outside a day-1 closing
      ],
      DAY1_18,
    );
    expect(r.n).toBe(3);
    expect(r.lines.map((l) => [l.fancierKey, l.points])).toEqual([["A", 3], ["B", 2], ["A", 1]]);
    // A: 4 points ÷ 10 = 0.4; B: 2 ÷ 2 = 1; C: home but outside the cutoff = 0.
    expect(r.fanciers.map((f) => [f.fancierKey, f.score, f.points, f.basketed, f.birdsScored])).toEqual([
      ["B", 1, 2, 2, 1], ["A", 0.4, 4, 10, 2], ["C", 0, 0, 4, 0],
    ]);
  });

  it("a day-2 closing includes day-1 birds and day-2 birds up to the time", () => {
    const r = calculateWeightedRace([bird("A", 500, 1, "17:00:00", 3), bird("A", 400, 2, "09:59:59", 3), bird("A", 300, 2, "10:00:01", 3)], { day: 2, time: "10:00:00" });
    expect(r.n).toBe(2);
    expect(r.fanciers[0]).toMatchObject({ points: 3, score: 1 });
  });

  it("rounds to 2 decimals and breaks score ties by best bird, then name", () => {
    const r = calculateWeightedRace([bird("B", 300, 1, "10:00:00", 3), bird("A", 200, 1, "10:00:00", 6), bird("A", 100, 1, "10:00:00", 6), bird("Z", 1, 1, "19:00:00", 1), bird("Y", 1, 1, "19:00:00", 1)], DAY1_18);
    expect(r.fanciers.map((f) => [f.fancierKey, f.score])).toEqual([["B", 1], ["A", 0.5], ["Y", 0], ["Z", 0]]);
    const third = calculateWeightedRace([bird("A", 100, 1, "10:00:00", 3)], DAY1_18);
    expect(third.fanciers[0]!.score).toBe(0.33);
  });

  it("exact speed ties keep Benzing's listing order", () => {
    const x = bird("X", 100, 1, "10:00:00", 1, { listOrder: 2 });
    const y = bird("Y", 100, 1, "10:00:00", 1, { listOrder: 1 });
    expect(calculateWeightedRace([x, y], DAY1_18).lines.map((l) => l.fancierKey)).toEqual(["Y", "X"]);
  });

  it("disqualified birds and fanciers are removed; basketed counts stay", () => {
    const a1 = bird("A", 300, 1, "10:00:00", 5);
    const r = calculateWeightedRace([a1, bird("A", 200, 1, "10:00:00", 5), bird("B", 100, 1, "10:00:00", 2)], DAY1_18, [
      { scope: "bird", target: a1.ring, reason: "clock fault" },
    ]);
    expect(r.n).toBe(2);
    expect(r.fanciers.map((f) => [f.fancierKey, f.score])).toEqual([["B", 0.5], ["A", 0.4]]);
    const noB = calculateWeightedRace([bird("A", 2, 1, "10:00:00", 1), bird("B", 1, 1, "10:00:00", 1)], DAY1_18, [{ scope: "fancier", target: "B", reason: "x" }]);
    expect(noB.fanciers.map((f) => f.fancierKey)).toEqual(["A"]);
    expect(noB.excluded).toHaveLength(1);
  });

  it("rejects incomplete input", () => {
    expect(() => calculateWeightedRace([bird("A", -1, 1, "10:00:00", 1)], DAY1_18)).toThrow(/speed/);
    expect(() => calculateWeightedRace([bird("A", 1, 1, "10:00:00", 1, { listOrder: 1.5 })], DAY1_18)).toThrow(/listOrder/);
    expect(() => calculateWeightedRace([bird("A", 1, 1, "10:00:00", 1, { arrivalDay: undefined })], DAY1_18)).toThrow(/arrival day/);
    expect(() => calculateWeightedRace([bird("A", 1, 1, "10:00", 1)], DAY1_18)).toThrow(/arrival day/);
    expect(() => calculateWeightedRace([bird("A", 1, 1, "10:00:00", 1, { arrivalTime: undefined })], DAY1_18)).toThrow(/arrival day/);
    expect(() => calculateWeightedRace([bird("A", 1, 1, "10:00:00", 0)], DAY1_18)).toThrow(/basketed/);
    const b = bird("A", 1, 1, "10:00:00", 1);
    expect(() => calculateWeightedRace([b, { ...b }], DAY1_18)).toThrow(/Duplicate/);
  });

  it("parses closing settings", () => {
    expect(parseClosing({ closingDay: "2", closingTime: "07:30" })).toEqual({ day: 2, time: "07:30:00" });
    expect(parseClosing({ closingDay: 1, closingTime: "18:00:59" })).toEqual({ day: 1, time: "18:00:59" });
    expect(() => parseClosing(null)).toThrow(/missing/);
    expect(() => parseClosing({ closingDay: 0, closingTime: "18:00" })).toThrow(/Closing day/);
    expect(() => parseClosing({ closingDay: 1, closingTime: "24:00" })).toThrow(/HH:MM/);
    expect(() => parseClosing({ closingDay: 1 })).toThrow(/HH:MM/);
  });

  it("system wrapper: needs per-race closing, describes itself", () => {
    expect(weightedByBasketing.parse({})).toEqual({});
    expect(weightedByBasketing.parseRace!({ closingDay: 1, closingTime: "18:00:00" })).toEqual({ closingDay: 1, closingTime: "18:00" });
    expect(() => weightedByBasketing.score([], {}, [], null)).toThrow(MissingRaceSettings);
    expect(weightedByBasketing.score([], {}, [], { closingDay: 1, closingTime: "18:00" }).n).toBe(0);
    expect(weightedByBasketing.describe({})).toMatch(/divided by the number of birds they basketed/);
  });

  it("Mooi River 2026, closing day 1 at 16:00", () => {
    const page = parseResultPage(readFileSync(new URL("../fixtures/benzing/r-6975-t-17084-mooiriver.html", import.meta.url), "utf8"));
    const r = calculateWeightedRace(
      page.arrivals.map((a) => ({ id: String(a.listOrder), fancierKey: a.fancierName, ring: a.ring, speedMilli: a.speedMilli, benzingPosition: a.position, listOrder: a.listOrder, arrivalDay: a.arrivalDay, arrivalTime: a.arrivalTime, basketed: a.loftBasketed })),
      { day: 1, time: "16:00:00" },
    );
    expect(r.n).toBe(197);
    expect(r.fanciers.map((f) => [f.fancierKey, f.birdsScored, f.points, f.basketed, f.score])).toEqual([
      ["Glenn Mcewan", 48, 4778, 65, 73.51],
      ["Scott King", 58, 6082, 83, 73.28],
      ["Larry Elliott", 27, 3168, 47, 67.4],
      ["Theuns Van Schalkwyk", 21, 1584, 31, 51.1],
      ["Wesley Phillips", 36, 3431, 74, 46.36],
      ["Willie du Plessis", 5, 211, 25, 8.44],
      ["Albert Venter", 2, 249, 47, 5.3],
    ]);
  });
});
