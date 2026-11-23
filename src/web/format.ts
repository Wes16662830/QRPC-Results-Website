export { fmtArrival, fmtDate, fmtSpeed } from "../core/exports";

/** ISO UTC → "18 Nov 2026, 10:05" in SAST. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export const fmtKm = (km: number | null | undefined) => (km === null || km === undefined ? "–" : `${km.toLocaleString("en-ZA", { maximumFractionDigits: 1 })} km`);

/** Whole numbers as-is; weighted (fractional) scores with 2 decimals. */
export const fmtPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Seconds as "0.4 s", "44.8 s", "12 min 05 s" or "1 h 02 min 05 s". */
export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h} h ${pad(m)} min ${pad(s)} s` : `${m} min ${pad(s)} s`;
}
