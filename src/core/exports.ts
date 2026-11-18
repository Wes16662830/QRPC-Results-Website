/** Export formats shared by the server (CSV) and the browser (WhatsApp text). Pure functions. */

export function csv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Quote when needed; neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const fmtSpeed = (mPerMin: number) =>
  mPerMin.toLocaleString("en-ZA", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const fmtArrival = (day: number, time: string) => (day > 1 ? `Day ${day} ${time}` : time);

export function fmtDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export interface WhatsAppRace {
  name: string;
  date: string;
  basketed: number | null;
  returned: number;
  firstBird: { fancierName: string; ring: string; speed: number } | null;
  fanciers: { rank: number | null; fancierName: string; score: number; birdsScored: number }[];
  n: number;
  scoringBirds: number;
  url?: string;
}

export function whatsappRaceSummary(r: WhatsAppRace): string {
  const lines = [
    `*QRPC – ${r.name}* (${fmtDate(r.date)})`,
    `${r.basketed ?? "?"} basketed · ${r.returned} home`,
  ];
  if (r.firstBird) lines.push(`1st bird: ${r.firstBird.fancierName} – ${fmtSpeed(r.firstBird.speed)} m/min`);
  lines.push("", `*${r.scoringBirds}-bird result* (${r.n} scoring birds)`);
  let shown = 0;
  for (const f of r.fanciers) {
    shown += 1;
    lines.push(`${f.rank ?? "="}. ${f.fancierName} – ${f.score} pts`);
  }
  if (shown === 0) lines.push("No scoring birds.");
  if (r.url) lines.push("", r.url);
  return lines.join("\n");
}

export function whatsappStandings(season: number, races: number, standings: { rank: number; fancierName: string; total: number }[], url?: string): string {
  const lines = [`*QRPC ${season} 5-bird championship*`, `After ${races} race${races === 1 ? "" : "s"}`, ""];
  for (const s of standings) lines.push(`${s.rank}. ${s.fancierName} – ${s.total} pts`);
  if (url) lines.push("", url);
  return lines.join("\n");
}
