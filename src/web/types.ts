// Shapes returned by the API (see src/server/queries.ts).
export type RaceState = "upcoming" | "live" | "awaiting" | "draft" | "published";

export interface RaceSummary {
  id: number;
  benzingRaceId: number;
  season: number;
  number: number | null;
  name: string;
  date: string;
  liberationTime: string | null;
  minDistanceKm: number | null;
  maxDistanceKm: number | null;
  basketed: number | null;
  fanciers: number | null;
  kind: "race" | "training";
  included: boolean;
  liveMode: "auto" | "on" | "off";
  state: RaceState;
}

export interface FullRow {
  position: number;
  fancierName: string;
  ring: string;
  sex: "cock" | "hen" | null;
  nomination: number | null;
  arrivalDay: number;
  arrivalTime: string;
  speed: number;
  distanceKm: number;
  loft: string;
}

export interface FiveBird {
  id: number;
  createdAt: string;
  publishedAt: string | null;
  n: number;
  warnings: string[];
  lines: { scoringPosition: number; points: number; fancierId: string; fancierName: string; ring: string; benzingPosition: number; speed: number; arrivalDay: number; arrivalTime: string }[];
  fanciers: { rank: number | null; fancierId: string; fancierName: string; score: number; birdsScored: number; benzingPositions: number[] }[];
  excluded: { arrivalId: string; reason: string; ring: string | null }[];
}

export interface BirdRef { fancierName: string; ring: string; arrivalTime: string; arrivalDay: number; speed: number }

export interface RaceDetail {
  race: RaceSummary;
  liberationPoint: string;
  sheetFetchedAt: string | null;
  benzingRecalculated: string | null;
  returned: number;
  firstBird: BirdRef | null;
  lastBird: BirdRef | null;
  entries: { fancierId: number; fancierName: string; basketed: number; returned: number }[];
  unaccountedBasketed: number;
  fullResult: FullRow[];
  fiveBird: FiveBird | null;
}

export interface AdminRaceDetail extends RaceDetail {
  draft: FiveBird | null;
  overrides: { id: number; scope: "bird" | "fancier"; target: string; reason: string; actor: string; created_at: string; revoked_at: string | null; revoked_by: string | null }[];
  benzingResultUrl: string | null;
  resultTypes: { id: number; typeName: string; percentage: number; active: boolean }[];
  fullResultId: number | null;
}

export interface Standing { rank: number; fancierId: number; fancierName: string; total: number; perRace: Record<string, number>; countedRaceIds: string[] }

export interface Championship {
  season: number;
  settings: { scoringBirds: number; racesCounted: "all" | "best"; bestX: number | null };
  races: { id: number; name: string; date: string; number: number | null }[];
  standings: Standing[];
}

export interface Home {
  season: number;
  latestRace: { race: RaceSummary; returned: number; top: FiveBird["fanciers"]; firstBird: BirdRef | null } | null;
  championshipTop5: Standing[];
  racesCounted: number;
  nextRace: RaceSummary | null;
  liveRaces: { id: number; name: string; arrivals: number }[];
}

export interface LiveData {
  pollIntervalMinutes: number;
  races: { race: RaceSummary; lastPolledAt: string | null; dataAsOf: string | null; arrivals: FullRow[]; provisional: Omit<FiveBird, "id" | "createdAt" | "publishedAt"> }[];
}

export interface FancierDetail {
  fancier: { id: number; name: string };
  season: number;
  totals: { basketed: number; returned: number; returnPct: number | null };
  standing: { rank: number; total: number; of: number } | null;
  races: { raceId: number; name: string; date: string; kind: string; included: boolean; basketed: number; returned: number; fiveBird: { score: number; n: number; birds: { ring: string; benzingPosition: number; scoringPosition: number; points: number }[] } | null }[];
}
