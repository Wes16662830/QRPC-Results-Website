import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BenzingParseError, parseResultPage } from "../src/core/benzing/parseResultPage";
import { combineLivePages, parseLiveArrivalsPage, parseLiveSpeedMilli } from "../src/core/benzing/parseLiveArrivals";
import { calculateRace } from "../src/core/scoring/fiveBird";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/benzing/${name}`, import.meta.url), "utf8");
const pages = [1, 2, 3].map((p) => parseLiveArrivalsPage(JSON.parse(fixture(`r-6975-on-the-fly-arrivals-p${p}.json`))));
const live = combineLivePages(pages);

describe("live arrivals (Mooi River)", () => {
  it("parses all pages", () => {
    expect(live).toHaveLength(265);
    expect(pages[0]).toMatchObject({ pageCount: 3, arrivalCount: 265, raceStatus: "R" });
    expect(live[0]).toMatchObject({ rank: 1, speedMilli: 1279742, distanceM: 477685, arrivalDay: 1, loftOrder: 1, loftBasketed: 74 });
    expect(live.at(-1)).toMatchObject({ arrivalDay: 12, arrivalTime: "10:40:28", speedMilli: 30380 });
    expect(new Set(live.map((a) => a.fancierId)).size).toBe(7);
  });

  it("agrees with the full result sheet bird for bird", () => {
    const sheet = parseResultPage(fixture("r-6975-t-17084-mooiriver.html")).arrivals;
    expect(live.map((a) => [a.ring, a.speedMilli, a.distanceM, a.arrivalDay, a.arrivalTime, a.loftBasketed])).toEqual(
      sheet.map((a) => [a.ring, a.speedMilli, a.distanceM, a.arrivalDay, a.arrivalTime, a.loftBasketed]),
    );
  });

  it("gives the same provisional 5-bird scores", () => {
    const calc = calculateRace(
      live.map((a) => ({ id: String(a.arrivalId), fancierKey: a.fancierName, ring: a.ring, speedMilli: a.speedMilli, benzingPosition: a.rank, listOrder: a.rank })),
      { scoringBirds: 5 },
    );
    expect(calc.fanciers.map((f) => f.score)).toEqual([122, 115, 109, 104, 47, 16, 15]);
  });
});

describe("live parser failures", () => {
  const good = JSON.parse(fixture("r-6975-on-the-fly-arrivals-p1.json"));
  const withArrival = (patch: Record<string, unknown>) => ({ ...good, arrivals: [{ ...good.arrivals[0], ...patch }] });

  it("rejects shape changes", () => {
    expect(() => parseLiveArrivalsPage(null)).toThrow(BenzingParseError);
    expect(() => parseLiveArrivalsPage([])).toThrow(/not an object/);
    expect(() => parseLiveArrivalsPage({ ...good, arrivals: "x" })).toThrow(/arrivals/);
    expect(() => parseLiveArrivalsPage({ ...good, arrivals: [1] })).toThrow(/Arrival is not an object/);
    expect(() => parseLiveArrivalsPage(withArrival({ arrival_id: "1" }))).toThrow(/arrival_id/);
    expect(() => parseLiveArrivalsPage(withArrival({ fancier_name: 3 }))).toThrow(/fancier_name/);
    expect(() => parseLiveArrivalsPage(withArrival({ time_of_arrival: "1:2" }))).toThrow(/arrival time/);
    expect(() => parseLiveArrivalsPage(withArrival({ distance: "477.685" }))).toThrow(/distance/);
    expect(() => parseLiveSpeedMilli("1279,742")).toThrow(/speed/);
    expect(parseLiveSpeedMilli("1094.04")).toBe(1094040);
    expect(parseLiveSpeedMilli("1094")).toBe(1094000);
  });

  it("accepts a missing nomination", () => {
    expect(parseLiveArrivalsPage(withArrival({ nomination: null })).arrivals[0]!.nomination).toBeNull();
  });

  it("detects pages that shifted between fetches", () => {
    expect(combineLivePages([])).toEqual([]);
    expect(() => combineLivePages([pages[0]!, { ...pages[1]!, arrivalCount: 266 }, pages[2]!])).toThrow(/changed/);
    expect(() => combineLivePages([pages[0]!, pages[1]!])).toThrow(/expected 265/);
    expect(() => combineLivePages([pages[0]!, pages[0]!, { ...pages[2]!, arrivals: pages[2]!.arrivals.slice(0, 65) }])).toThrow(/Duplicate/);
  });
});
