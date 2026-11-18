/**
 * Parser for a Benzing MyPigeons public result page:
 *   https://mypigeons.benzing.live/za/en/results/view/r-{raceId}-t-{resultId}-{slug}/
 *
 * Pure string parsing (no DOM) so it runs unchanged in Node, Vitest and Cloudflare Workers.
 * Columns are located by their header text, because Benzing's template shows some
 * columns (e.g. "Nom.") only conditionally. The page must be requested in English (/en/).
 */

export type Sex = "cock" | "hen" | null;

export interface BenzingArrival {
  /** Benzing's rank. Equal speeds share a rank (e.g. 25, 25, 27). */
  position: number;
  /** Row order on Benzing's sheet (1..n, unique). Used to break exact speed ties. */
  listOrder: number;
  nomination: number | null;
  fancierName: string;
  ring: string;
  sex: Sex;
  /** Day of the race the bird arrived on; 1 = liberation day. */
  arrivalDay: number;
  /** Local clock time "HH:MM:SS" (SAST). */
  arrivalTime: string;
  /** Speed in metres per minute × 1000, as an exact integer. */
  speedMilli: number;
  /** Distance in metres, as an exact integer. */
  distanceM: number;
  /** n in "n/m": this bird was the fancier's nth home. */
  loftOrder: number;
  /** m in "n/m": birds basketed by this fancier. */
  loftBasketed: number;
}

export interface BenzingResultHeader {
  basketedTotal: number | null;
  fanciersTotal: number | null;
  raceNumber: string | null;
  date: string | null;
  liberationTime: string | null;
  liberationPoint: string | null;
  lastRecalculation: string | null;
}

export interface BenzingResultPage {
  header: BenzingResultHeader;
  arrivals: BenzingArrival[];
}

export class BenzingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenzingParseError";
  }
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&middot;": "·",
  "&ndash;": "–",
};

function decode(s: string): string {
  return s
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

function text(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** "1 279,742" → 1279742 ; "30,380" → 30380 (m/min × 1000). */
export function parseSpeedMilli(raw: string): number {
  const m = /^(\d{1,3}(?: \d{3})*),(\d{3})$/.exec(raw.trim());
  if (!m) throw new BenzingParseError(`Unexpected speed format: "${raw}"`);
  return Number(m[1]!.replace(/ /g, "")) * 1000 + Number(m[2]);
}

/** "477.685" (km) → 477685 (m). */
export function parseDistanceM(raw: string): number {
  const m = /^(\d+)\.(\d{3})$/.exec(raw.trim());
  if (!m) throw new BenzingParseError(`Unexpected distance format: "${raw}"`);
  return Number(m[1]) * 1000 + Number(m[2]);
}

/** "14:28:13" → day 1; "(12) 10:40:28" → day 12. */
export function parseArrival(raw: string): { day: number; time: string } {
  const m = /^(?:\((\d+)\)\s*)?(\d{2}:\d{2}:\d{2})$/.exec(raw.trim());
  if (!m) throw new BenzingParseError(`Unexpected arrival format: "${raw}"`);
  return { day: m[1] ? Number(m[1]) : 1, time: m[2]! };
}

function headerValue(html: string, key: string): string | null {
  const re = new RegExp(
    `<span class="rh-key">\\s*${key}\\s*</span>\\s*<span class="rh-val">([\\s\\S]*?)</span>`,
  );
  const m = re.exec(html);
  return m ? text(m[1]!) : null;
}

function statValue(html: string, label: string): number | null {
  const re = new RegExp(
    `<div class="rh-stat-value">([^<]*)</div>\\s*<div class="rh-stat-label">\\s*${label}`,
  );
  const m = re.exec(html);
  return m ? Number(text(m[1]!).replace(/\D/g, "")) : null;
}

function parseHeader(html: string): BenzingResultHeader {
  const title = /<div class="rh-card-title">([\s\S]*?)<\/div>/.exec(html);
  const recalc = /Last re-calculation:<\/strong>\s*([0-9.]+,\s*[0-9:]+)/.exec(html);
  return {
    basketedTotal: statValue(html, "Nr\\. of Pigeons"),
    fanciersTotal: statValue(html, "Nr\\. of Fanciers"),
    raceNumber: headerValue(html, "Race Nr\\."),
    date: headerValue(html, "Date"),
    liberationTime: headerValue(html, "Time of Liberation"),
    liberationPoint: title ? text(title[1]!) : null,
    lastRecalculation: recalc ? recalc[1]!.replace(/\s+/g, " ") : null,
  };
}

const REQUIRED = ["#", "Fancier / Team", "Pigeon", "Arrival", "Speed", "Distance [km]", "Loft Position"] as const;

export function parseResultPage(html: string): BenzingResultPage {
  const tableMatch = /<table class="table table-sm table-striped[^"]*">([\s\S]*?)<\/table>/.exec(html);
  if (!tableMatch) throw new BenzingParseError("Result table not found");
  const table = tableMatch[1]!;

  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!);
  const headerRow = rows.find((r) => r.includes("<th"));
  if (!headerRow) throw new BenzingParseError("Result table has no header row");
  const headers = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]!));

  const col: Record<string, number> = {};
  headers.forEach((h, i) => (col[h] = i));
  for (const name of REQUIRED) {
    if (col[name] === undefined) throw new BenzingParseError(`Missing column "${name}" (got: ${headers.join(" | ")})`);
  }
  const nomCol = col["Nom."];

  const arrivals: BenzingArrival[] = [];
  for (const row of rows) {
    if (row.includes("<th")) continue;
    const cellsHtml = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!);
    if (cellsHtml.length === 0) continue;
    if (cellsHtml.length !== headers.length) {
      throw new BenzingParseError(`Row has ${cellsHtml.length} cells, expected ${headers.length}`);
    }
    const cells = cellsHtml.map(text);
    const get = (name: string) => cells[col[name]!]!;

    const loft = /^(\d+)\/(\d+)$/.exec(get("Loft Position"));
    if (!loft) throw new BenzingParseError(`Unexpected loft position: "${get("Loft Position")}"`);
    const arrival = parseArrival(get("Arrival"));
    const pigeonHtml = cellsHtml[col["Pigeon"]!]!;
    const sexTitle = /title="(Hen|Cock)"/i.exec(pigeonHtml)?.[1]?.toLowerCase();
    const position = Number(get("#"));
    if (!Number.isInteger(position) || position < 1) {
      throw new BenzingParseError(`Unexpected position: "${get("#")}"`);
    }

    arrivals.push({
      position,
      listOrder: arrivals.length + 1,
      nomination: nomCol === undefined || cells[nomCol] === "" ? null : Number(cells[nomCol]),
      fancierName: get("Fancier / Team"),
      ring: get("Pigeon"),
      sex: sexTitle === "hen" ? "hen" : sexTitle === "cock" ? "cock" : null,
      arrivalDay: arrival.day,
      arrivalTime: arrival.time,
      speedMilli: parseSpeedMilli(get("Speed")),
      distanceM: parseDistanceM(get("Distance [km]")),
      loftOrder: Number(loft[1]),
      loftBasketed: Number(loft[2]),
    });
  }

  return { header: parseHeader(html), arrivals };
}

/**
 * Sanity checks before a snapshot may be stored. Returns a list of problems (empty = OK).
 * A failed check means: keep the last good snapshot and raise an admin alert.
 */
export function validateResultPage(page: BenzingResultPage): string[] {
  const problems: string[] = [];
  const a = page.arrivals;
  if (a.length === 0) problems.push("No arrivals");
  a.forEach((r, i) => {
    const prev = a[i - 1];
    // Benzing ranks competition-style: equal speed shares the rank, the next rank skips.
    const expected = prev && prev.speedMilli === r.speedMilli ? prev.position : i + 1;
    if (r.position !== expected) problems.push(`Unexpected position at row ${i + 1}: got ${r.position}, expected ${expected}`);
    if (prev && r.speedMilli > prev.speedMilli) problems.push(`Speed increases at row ${i + 1}`);
  });
  const basketedByFancier = new Map<string, number>();
  for (const r of a) {
    const known = basketedByFancier.get(r.fancierName);
    if (known !== undefined && known !== r.loftBasketed) {
      problems.push(`Inconsistent basketed count for ${r.fancierName}`);
    }
    basketedByFancier.set(r.fancierName, r.loftBasketed);
  }
  const sum = [...basketedByFancier.values()].reduce((s, n) => s + n, 0);
  if (page.header.basketedTotal !== null && sum > page.header.basketedTotal) {
    problems.push(`Fanciers' basketed counts (${sum}) exceed race total (${page.header.basketedTotal})`);
  }
  return problems;
}
