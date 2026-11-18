import { Fragment, useState } from "react";
import { fmtArrival, fmtSpeed } from "./format";
import type { Calc, FullRow, RaceDetail } from "./types";
import { FancierLink, TableWrap } from "./ui";

type CalcView = Pick<Calc, "n" | "lines" | "fanciers" | "excluded">;

export function ScoreTable({ calc, rules }: { calc: CalcView; rules?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        {calc.n} scoring birds. {rules}
      </p>
      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Fancier</th>
              <th className="num">Birds</th>
              <th>Places in full result</th>
              <th className="num">Points</th>
            </tr>
          </thead>
          <tbody>
            {calc.fanciers.map((f) => (
              <Fragment key={f.fancierId}>
                <tr className="cursor-pointer" onClick={() => setOpen(open === f.fancierId ? null : f.fancierId)}>
                  <td className="num text-muted">{f.rank ?? "="}</td>
                  <td>
                    <FancierLink id={f.fancierId} name={f.fancierName} />
                  </td>
                  <td className="num">{f.birdsScored}</td>
                  <td className="text-muted">{f.benzingPositions.join(", ")}</td>
                  <td className="num text-base font-bold">{f.score}</td>
                </tr>
                {open === f.fancierId && (
                  <tr className="bg-surface-2">
                    <td colSpan={5}>
                      <div className="py-1 text-sm">
                        {calc.lines
                          .filter((l) => l.fancierId === f.fancierId)
                          .map((l) => (
                            <div key={l.ring} className="flex justify-between gap-4">
                              <span>
                                {l.ring} · {fmtArrival(l.arrivalDay, l.arrivalTime)} · {fmtSpeed(l.speed)} m/min
                              </span>
                              <span className="text-muted">
                                scoring #{l.scoringPosition} → <strong className="text-ink">{l.points}</strong>
                              </span>
                            </div>
                          ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="no-print mt-2 text-xs text-muted">Tap a fancier to see their scoring birds.</p>
      {calc.excluded.length > 0 && (
        <p className="mt-3 text-sm text-warn">
          Disqualified: {calc.excluded.map((e) => `${e.ring ?? e.arrivalId} (${e.reason})`).join("; ")}
        </p>
      )}
    </>
  );
}

export function ScoringBirds({ calc }: { calc: CalcView }) {
  return (
    <TableWrap>
      <table className="data">
        <thead>
          <tr>
            <th className="num">Scoring</th>
            <th>Fancier</th>
            <th>Ring</th>
            <th className="num">Full pos.</th>
            <th className="num">Speed</th>
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {calc.lines.map((l) => (
            <tr key={l.ring + l.scoringPosition}>
              <td className="num">{l.scoringPosition}</td>
              <td>{l.fancierName}</td>
              <td className="text-muted">{l.ring}</td>
              <td className="num text-muted">{l.benzingPosition}</td>
              <td className="num">{fmtSpeed(l.speed)}</td>
              <td className="num font-semibold">{l.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function FullResult({ rows, highlight, highlightLabel }: { rows: FullRow[]; highlight?: Set<string>; highlightLabel?: string }) {
  const [filter, setFilter] = useState("");
  const shown = filter ? rows.filter((r) => r.fancierName === filter) : rows;
  const fanciers = [...new Set(rows.map((r) => r.fancierName))].sort();
  return (
    <>
      <div className="no-print mb-3">
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by fancier">
          <option value="">All fanciers ({rows.length} birds)</option>
          {fanciers.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th className="num">Pos</th>
              <th>Fancier</th>
              <th>Ring</th>
              <th>Arrival</th>
              <th className="num">Speed m/min</th>
              <th className="num">km</th>
              <th className="num">Loft</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.ring + r.position} className={highlight?.has(r.ring) ? "bg-accent-soft" : ""}>
                <td className="num">{r.position}</td>
                <td>{r.fancierName}</td>
                <td className="text-muted">{r.ring}</td>
                <td>{fmtArrival(r.arrivalDay, r.arrivalTime)}</td>
                <td className="num">{fmtSpeed(r.speed)}</td>
                <td className="num text-muted">{r.distanceKm.toFixed(3)}</td>
                <td className="num text-muted">{r.loft}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {highlight && <p className="mt-2 text-xs text-muted">Highlighted birds are scoring birds in the {highlightLabel ?? "main"} result.</p>}
    </>
  );
}

export function EntriesTable({ detail }: { detail: RaceDetail }) {
  return (
    <TableWrap>
      <table className="data">
        <thead>
          <tr>
            <th>Fancier</th>
            <th className="num">Basketed</th>
            <th className="num">Home</th>
            <th className="num">Return %</th>
          </tr>
        </thead>
        <tbody>
          {detail.entries.map((e) => (
            <tr key={e.fancierId}>
              <td>
                <FancierLink id={e.fancierId} name={e.fancierName} />
              </td>
              <td className="num">{e.basketed}</td>
              <td className="num">{e.returned}</td>
              <td className="num">{e.basketed ? Math.round((e.returned / e.basketed) * 100) : 0}%</td>
            </tr>
          ))}
          {detail.unaccountedBasketed > 0 && (
            <tr>
              <td className="text-muted">Other fancier(s), none home</td>
              <td className="num">{detail.unaccountedBasketed}</td>
              <td className="num">0</td>
              <td className="num">0%</td>
            </tr>
          )}
        </tbody>
      </table>
    </TableWrap>
  );
}
