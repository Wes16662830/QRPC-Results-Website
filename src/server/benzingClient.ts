/**
 * THE Benzing adapter: every call to mypigeons.benzing.live goes through here.
 * Read-only GETs, at most 1 request per second, identifying User-Agent.
 * If Benzing changes, this file and src/core/benzing/* are the only places to fix.
 */
import { parseResultPage, validateResultPage, type BenzingResultPage } from "../core/benzing/parseResultPage";
import { combineLivePages, LIVE_PAGE_LIMIT, parseLiveArrivalsPage, type LiveArrival } from "../core/benzing/parseLiveArrivals";
import { parseRaceList, type BenzingRace } from "../core/benzing/parseRaceList";

export const BENZING_BASE = "https://mypigeons.benzing.live";
export const USER_AGENT = "QRPC-Results/1.0 (Queenstown RPC results site; read-only)";
const MIN_INTERVAL_MS = 1000;

export class BenzingError extends Error {
  constructor(message: string, readonly url: string) {
    super(message);
    this.name = "BenzingError";
  }
}

export interface ClubRef {
  country: string;
  benzingOrgId: number;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export class BenzingClient {
  private lastCall = 0;

  constructor(
    private readonly fetcher: Fetcher = (u, i) => fetch(u, i),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async get(path: string, accept: string): Promise<string> {
    const wait = this.lastCall + MIN_INTERVAL_MS - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastCall = this.now();
    const url = BENZING_BASE + path;
    let res: Response;
    try {
      res = await this.fetcher(url, { method: "GET", headers: { "User-Agent": USER_AGENT, Accept: accept }, redirect: "manual" });
    } catch (e) {
      throw new BenzingError(`Network error: ${(e as Error).message}`, url);
    }
    if (res.status !== 200) throw new BenzingError(`HTTP ${res.status}`, url);
    return res.text();
  }

  private async getJson(path: string): Promise<unknown> {
    const body = await this.get(path, "application/json");
    try {
      return JSON.parse(body);
    } catch {
      throw new BenzingError("Response is not JSON", BENZING_BASE + path);
    }
  }

  async raceList(club: ClubRef, season: number, kind: "races" | "training-races"): Promise<BenzingRace[]> {
    return parseRaceList(await this.getJson(`/api/v2/${club.country}/smartclub/${club.benzingOrgId}/${season}/${kind}`));
  }

  resultSheetPath(club: ClubRef, raceId: number, resultId: number, slug: string): string {
    return `/${club.country}/en/results/view/r-${raceId}-t-${resultId}-${encodeURIComponent(slug)}/`;
  }

  async resultSheet(club: ClubRef, raceId: number, resultId: number, slug: string): Promise<{ page: BenzingResultPage; url: string }> {
    const path = this.resultSheetPath(club, raceId, resultId, slug);
    const page = parseResultPage(await this.get(path, "text/html"));
    const problems = validateResultPage(page);
    if (problems.length) throw new BenzingError(`Result sheet failed checks: ${problems.slice(0, 5).join("; ")}`, BENZING_BASE + path);
    return { page, url: BENZING_BASE + path };
  }

  async liveArrivals(club: ClubRef, raceId: number): Promise<{ arrivals: LiveArrival[]; raceStatus: string; url: string }> {
    const path = (p: number) => `/api/v2/${club.country}/club-races/${raceId}/on-the-fly/arrivals?page_number=${p}&limit=${LIVE_PAGE_LIMIT}`;
    const first = parseLiveArrivalsPage(await this.getJson(path(1)));
    const pages = [first];
    for (let p = 2; p <= first.pageCount; p++) pages.push(parseLiveArrivalsPage(await this.getJson(path(p))));
    return { arrivals: combineLivePages(pages), raceStatus: first.raceStatus, url: BENZING_BASE + path(1) };
  }
}
