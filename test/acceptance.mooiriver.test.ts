/**
 * ACCEPTANCE TEST — must pass before anything ships.
 * Mooi River 2026 (Benzing race 6975), full result sheet t-17084, captured 18 Nov 2026.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseResultPage, validateResultPage } from "../src/core/benzing/parseResultPage";
import { calculateRace } from "../src/core/scoring/fiveBird";

const html = readFileSync(new URL("../fixtures/benzing/r-6975-t-17084-mooiriver.html", import.meta.url), "utf8");
const page = parseResultPage(html);

const expected = [
  { fancier: "Glenn Mcewan", places: [5, 8, 9, 10, 11], score: 122 },
  { fancier: "Wesley Phillips", places: [1, 2, 15, 16, 41], score: 115 },
  { fancier: "Larry Elliott", places: [6, 7, 14, 17, 18], score: 109 },
  { fancier: "Scott King", places: [3, 4, 22, 23, 24], score: 104 },
  { fancier: "Theuns Van Schalkwyk", places: [46, 60, 68, 74, 75], score: 47 },
  { fancier: "Albert Venter", places: [67, 80], score: 16 },
  { fancier: "Willie du Plessis", places: [135, 140, 151, 169, 184], score: 15 },
];

describe("Mooi River 2026 acceptance", () => {
  it("parses the full truck result", () => {
    expect(page.header.basketedTotal).toBe(372);
    expect(page.header.fanciersTotal).toBe(7);
    expect(page.header.liberationTime).toBe("08:15:00");
    expect(page.arrivals).toHaveLength(265);
    expect(validateResultPage(page)).toEqual([]);
    expect(new Set(page.arrivals.map((a) => a.fancierName)).size).toBe(7);
    const last = page.arrivals.at(-1)!;
    expect(page.arrivals.filter((a, i, all) => i > 0 && all[i - 1]!.position === a.position).map((a) => a.position)).toEqual([25, 47, 81, 171]);
    expect(last).toMatchObject({ position: 265, listOrder: 265, arrivalDay: 12, arrivalTime: "10:40:28", speedMilli: 30380 });
  });

  it("produces the agreed 5-bird race scores", () => {
    const calc = calculateRace(
      page.arrivals.map((a) => ({
        id: a.ring,
        fancierKey: a.fancierName,
        ring: a.ring,
        speedMilli: a.speedMilli,
        benzingPosition: a.position,
        listOrder: a.listOrder,
      })),
      { scoringBirds: 5 },
    );
    expect(calc.n).toBe(32);
    expect(
      calc.fanciers.map((f) => ({ fancier: f.fancierKey, places: f.benzingPositions, score: f.score })),
    ).toEqual(expected);
    const glenn = calc.lines.filter((l) => l.fancierKey === "Glenn Mcewan").map((l) => l.points);
    expect(glenn).toEqual([28, 25, 24, 23, 22]);
    expect(calc.fanciers.reduce((s, f) => s + f.score, 0)).toBe((32 * 33) / 2);
  });
});

describe("Matatiele 1 2026 (distances with dropped trailing zeros)", () => {
  it("parses and validates the full sheet", () => {
    const m1 = parseResultPage(readFileSync(new URL("../fixtures/benzing/r-6429-t-17076-matatiele-1.html", import.meta.url), "utf8"));
    expect(m1.arrivals).toHaveLength(322);
    expect(validateResultPage(m1)).toEqual([]);
    expect(m1.arrivals.every((a) => a.distanceM > 100_000 && a.distanceM < 1_000_000)).toBe(true);
    expect(m1.arrivals.reduce((s, a) => s.add(a.fancierName), new Set<string>()).size).toBe(8);
  });
});
