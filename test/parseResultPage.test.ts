import { describe, expect, it } from "vitest";
import {
  BenzingParseError, parseArrival, parseDistanceM, parseResultPage, parseSpeedMilli, validateResultPage,
} from "../src/core/benzing/parseResultPage";

const HEAD = `<tr><th>#</th><th>Fancier / Team</th><th>Pigeon</th><th>Arrival</th><th>Speed</th><th>Distance [km]</th><th>Loft Position</th></tr>`;
const row = (pos: number, f: string, speed: string, loft = "1/5", arrival = "10:00:00") =>
  `<tr><td>${pos}</td><td>${f}</td><td><span title="Cock"></span>ZA-1</td><td>${arrival}</td><td>${speed}</td><td>100.000</td><td>${loft}</td></tr>`;
const page = (rows: string, head = HEAD) => `<table class="table table-sm table-striped ">${head}${rows}</table>`;

describe("field parsers", () => {
  it("parses speed, distance and arrival", () => {
    expect(parseSpeedMilli("1 279,742")).toBe(1279742);
    expect(parseSpeedMilli("30,380")).toBe(30380);
    expect(parseDistanceM("477.685")).toBe(477685);
    // Real Benzing output drops trailing zeros (Matatiele 1, Ladysmith 1, Newcastle 2).
    expect(parseDistanceM("305.34")).toBe(305340);
    expect(parseDistanceM("511.5")).toBe(511500);
    expect(parseDistanceM("590")).toBe(590000);
    expect(parseArrival("(12) 10:40:28")).toEqual({ day: 12, time: "10:40:28" });
    expect(parseArrival("14:28:13")).toEqual({ day: 1, time: "14:28:13" });
  });
  it("rejects unexpected formats", () => {
    expect(() => parseSpeedMilli("1279.742")).toThrow(BenzingParseError);
    expect(() => parseDistanceM("477,685")).toThrow(BenzingParseError);
    expect(() => parseDistanceM("477.6851")).toThrow(BenzingParseError);
    expect(() => parseArrival("2:00")).toThrow(BenzingParseError);
  });
});

describe("parseResultPage", () => {
  it("works without the optional Nom. column and reads sex", () => {
    const p = parseResultPage(page(row(1, "A", "1 000,000")));
    expect(p.arrivals[0]).toMatchObject({ nomination: null, sex: "cock", fancierName: "A", listOrder: 1 });
    expect(p.header.basketedTotal).toBeNull();
  });
  it("fails loudly on structural changes", () => {
    expect(() => parseResultPage("<html></html>")).toThrow(/table not found/);
    expect(() => parseResultPage(page(row(1, "A", "1,000"), ""))).toThrow(/header/);
    expect(() => parseResultPage(page(row(1, "A", "1,000"), HEAD.replace("Speed", "Velocity")))).toThrow(/Missing column "Speed"/);
    expect(() => parseResultPage(page("<tr><td>1</td></tr>"))).toThrow(/cells/);
    expect(() => parseResultPage(page(row(1, "A", "1,000", "x")))).toThrow(/loft position/);
    expect(() => parseResultPage(page(row(0, "A", "1,000")))).toThrow(/position/);
  });
});

describe("validateResultPage", () => {
  const p = (rows: string) => parseResultPage(page(rows));
  it("accepts competition-style shared ranks", () => {
    expect(validateResultPage(p(row(1, "A", "2,000") + row(1, "B", "2,000", "1/5") + row(3, "A", "1,000", "2/5")))).toEqual([]);
  });
  it("flags gaps, rising speed, inconsistent basketing and empty pages", () => {
    expect(validateResultPage(p(row(1, "A", "1,000") + row(3, "A", "0,900")))).toEqual([
      "Unexpected position at row 2: got 3, expected 2",
    ]);
    expect(validateResultPage(p(row(1, "A", "1,000") + row(2, "A", "2,000")))[0]).toMatch(/Speed increases/);
    expect(validateResultPage(p(row(1, "A", "2,000", "1/5") + row(2, "A", "1,000", "2/6")))).toEqual([
      "Inconsistent basketed count for A",
    ]);
    expect(validateResultPage({ header: { basketedTotal: null } as never, arrivals: [] })).toEqual(["No arrivals"]);
    const tooMany = p(row(1, "A", "1,000", "1/50"));
    tooMany.header.basketedTotal = 10;
    expect(validateResultPage(tooMany)).toEqual(["Fanciers' basketed counts (50) exceed race total (10)"]);
  });
});
