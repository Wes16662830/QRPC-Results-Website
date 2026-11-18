import { Fragment, useState } from "react";
import { fmtArrival, fmtPoints, fmtSpeed } from "./format";
import type { Calc, CompetitionInfo, FullRow, RaceDetail } from "./types";
import { FancierLink, TableWrap } from "./ui";

type CalcView = Pick<Calc, "n" | "lines" | "fanciers" | "excluded">;

/** Result of one competition for one race: birds for bird competitions, fanciers otherwise. */
export function CompetitionResultView({ calc, competition }: { calc: CalcView; competition: Pick<CompetitionInfo, "entity" | "unit" | "rules" | "params"> }) {
  if (competition.entity === "bird") {
    return (
      <>
        <p className="mb-3 text-sm text-muted">{competition.rules}</p>
        <ScoringBirds calc={calc} />
      </>
    );
  }
  return <ScoreTable calc={calc} rules={competition.rules} unit={competition.unit} percent={Number(competition.params.percent) || undefined} />;
}

export function ScoreTable({ calc, rules, unit = "Points", percent }: { calc: CalcView; rules?: string; unit?: string; percent?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const fmt = (v: number) => (unit === "%" ? `${fmtPoints(v)}%` : fmtPoints(v));
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        {unit === "Points" ? `${calc.n} scoring birds. ` : ""}
        {rules}
      </p>
      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Fancier</th>
              <th className="num">{unit}</th>
            </tr>
          </thead>
          <tbody>
            {calc.fanciers.map((f) => (
              <Fragment key={f.fancierId}>
                <tr className="cursor-pointer" onClick={() => setOpen(open === f.fancierId ? null : f.fancierId)}>
                  <td className="num align-top text-muted">{f.rank ?? "="}</td>
                  <td className="wrap">
                    <FancierLink id={f.fancierId} name={f.fancierName} />
                    <div className="text-xs text-muted">
                      {unit === "%"
                        ? `${f.points} of ${f.basketed} basketed in the top ${percent ?? "X"}%`
                        : unit === "Wins"
                          ? f.score
                            ? "first bird home"
                            : ""
                          : `${f.birdsScored} bird${f.birdsScored === 1 ? "" : "s"}${f.basketed !== undefined ? ` · ${f.points} pts ÷ ${f.basketed} basketed` : ""}`}
                      {f.benzingPositions.length > 0 && ` · places ${f.benzingPositions.length > 12 ? `${f.benzingPositions.slice(0, 12).join(", ")} …` : f.benzingPositions.join(", ")}`}
                    </div>
                  </td>
                  <td className="num align-top text-base font-bold">{fmt(f.score)}</td>
                </tr>
                {open === f.fancierId && (
                  <tr className="bg-surface-2">
                    <td colSpan={3} className="wrap">
                      <div className="py-1 text-sm">
                        {calc.lines
                          .filter((l) => l.fancierId === f.fancierId)
                          .map((l) => (
                            <div key={l.ring} className="flex flex-wrap justify-between gap-x-4">
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
              <td className="num font-semibold">{fmtPoints(l.points)}</td>
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
                <td className="num text-muted">{r.distanceKm.toLocaleString("en-ZA", { minimumFractionDigits: 3 })}</td>
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
