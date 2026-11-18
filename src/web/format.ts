export { fmtArrival, fmtDate, fmtSpeed } from "../core/exports";

/** ISO UTC → "18 Nov 2026, 10:05" in SAST. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export const fmtKm = (km: number | null | undefined) => (km === null || km === undefined ? "–" : `${km.toLocaleString("en-ZA", { maximumFractionDigits: 1 })} km`);
