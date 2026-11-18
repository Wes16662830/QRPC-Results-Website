import { Link, useSearchParams } from "react-router";
import { fmtPoints } from "../format";
import { useApi } from "../hooks";
import { ExportBar } from "../share";
import type { Championship, CompetitionInfo } from "../types";
import { Card, ErrorBox, FancierLink, Loading, Notice, PageTitle, TableWrap } from "../ui";

export function CompetitionPicker({ value, onChange, source = "/api/competitions" }: { value: string; onChange: (slug: string) => void; source?: string }) {
  const { data: raw } = useApi<CompetitionInfo[] | { competitions: CompetitionInfo[] }>(source);
  const data = raw ? (Array.isArray(raw) ? raw : raw.competitions.filter((c) => c.active)) : null;
  if (!data || data.length < 2) return null;
  if (data.length > 4) {
    return (
      <div className="no-print mb-4">
        <select className="input font-semibold" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Competition">
          {data.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
              {c.visibility === "admin" ? " (admin only)" : ""}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="no-print mb-4 flex flex-wrap gap-2">
      {data.map((c) => (
        <button
          key={c.slug}
          onClick={() => onChange(c.slug)}
          className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${value === c.slug ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted"}`}
        >
          {c.name}
          {c.visibility === "admin" && " (admin only)"}
        </button>
      ))}
    </div>
  );
}

/** Standings for any competition: fanciers or birds, points, wins or season percentages. */
function StandingsTable({ data }: { data: Championship }) {
  const c = data.competition;
  const bird = c.entity === "bird";
  const pct = c.unit === "%";
  const fmt = (v: number) => (pct ? `${fmtPoints(v)}%` : fmtPoints(v));
  const shown = bird ? data.standings.slice(0, 100) : data.standings;
  return (
    <>
      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{bird ? "Bird" : "Fancier"}</th>
              <th className="num">{pct ? "Season %" : c.unit === "Wins" ? "Wins" : "Total"}</th>
              {pct && <th className="num">Top / basketed</th>}
              {bird && <th className="num">Races</th>}
              {data.races.map((r) => (
                <th key={r.id} className="num">
                  <Link to={`/races/${r.id}`} title={r.name}>
                    {r.number ? `R${r.number}` : r.name.slice(0, 6)}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.ring ?? s.fancierId ?? s.fancierName}>
                <td className="num align-top text-muted">{s.rank}</td>
                <td className={bird ? "wrap" : ""}>
                  {bird ? (
                    <>
                      <span className="whitespace-nowrap font-medium">{s.ring}</span>
                      <div className="text-xs">
                        <FancierLink id={s.fancierId} name={s.fancierName} />
                      </div>
                    </>
                  ) : (
                    <FancierLink id={s.fancierId} name={s.fancierName} />
                  )}
                </td>
                <td className="num align-top text-base font-bold">{fmt(s.total)}</td>
                {pct && <td className="num align-top text-muted">{s.points} / {s.basketed}</td>}
                {bird && <td className="num align-top text-muted">{s.racesScored}</td>}
                {data.races.map((r) => {
                  const v = s.perRace[String(r.id)];
                  const isCounted = pct || s.countedRaceIds.includes(String(r.id));
                  // No entry: "–". Percent races show 0% when he raced; points/wins show "–" for 0.
                  const text = v === undefined ? "–" : pct ? fmt(v) : v ? fmt(v) : "–";
                  return (
                    <td key={r.id} className={`num align-top ${isCounted ? "" : "text-muted line-through"}`}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {bird && data.standings.length > shown.length && (
        <p className="mt-2 text-xs text-muted">Showing the top {shown.length} of {data.standings.length} birds. The CSV has them all.</p>
      )}
      {pct && <p className="mt-2 text-xs text-muted">Season % = all birds in the top {String(c.params.percent ?? "")}% ÷ all birds basketed. Race columns show each race's %.</p>}
    </>
  );
}

export function ChampionshipPage({ admin = false }: { admin?: boolean }) {
  const [params, setParams] = useSearchParams();
  const slug = params.get("competition");
  const base = admin ? "/api/admin/championship" : "/api/championship";
  const { data, error } = useApi<Championship>(`${base}${slug ? `?competition=${encodeURIComponent(slug)}` : ""}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const c = data.competition;
  const counted = c.racesCounted === "all" ? "all races count" : `best ${c.bestX} races count`;
  const q = `season=${data.season}&competition=${c.slug}`;
  return (
    <>
      <PageTitle title={`${data.season} ${c.name}`} sub={`${data.races.length} published races · ${counted}`} />
      <CompetitionPicker value={c.slug} onChange={(s) => setParams({ competition: s })} source={admin ? "/api/admin/competitions" : undefined} />
      {c.visibility === "admin" && <div className="mb-4"><Notice>Admin only: members can't see this competition. Switch it on in Settings when you're happy with it.</Notice></div>}
      {data.standings.length === 0 ? (
        <Notice tone="info">No race results have been published for this competition yet.</Notice>
      ) : (
        <Card>
          {!admin && <ExportBar csv={[[`/api/championship/export.csv?${q}`, "CSV"]]} whatsappPath={`/api/championship/whatsapp?${q}`} />}
          <StandingsTable data={data} />
          {c.racesCounted === "best" && <p className="mt-2 text-xs text-muted">Struck-through scores are not counted (best {c.bestX}).</p>}
        </Card>
      )}
    </>
  );
}
