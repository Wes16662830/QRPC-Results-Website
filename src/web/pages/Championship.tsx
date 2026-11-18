import { Link, useSearchParams } from "react-router";
import { useApi } from "../hooks";
import { ExportBar } from "../share";
import type { Championship, CompetitionInfo } from "../types";
import { Card, ErrorBox, FancierLink, Loading, Notice, PageTitle, TableWrap } from "../ui";

export function CompetitionPicker({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
  const { data } = useApi<CompetitionInfo[]>("/api/competitions");
  if (!data || data.length < 2) return null;
  return (
    <div className="no-print mb-4 flex flex-wrap gap-2">
      {data.map((c) => (
        <button
          key={c.slug}
          onClick={() => onChange(c.slug)}
          className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${value === c.slug ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted"}`}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

export function ChampionshipPage() {
  const [params, setParams] = useSearchParams();
  const slug = params.get("competition");
  const { data, error } = useApi<Championship>(`/api/championship${slug ? `?competition=${encodeURIComponent(slug)}` : ""}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const c = data.competition;
  const counted = c.racesCounted === "all" ? "all races count" : `best ${c.bestX} races count`;
  const q = `season=${data.season}&competition=${c.slug}`;
  return (
    <>
      <PageTitle title={`${data.season} ${c.name}`} sub={`${data.races.length} published races · ${counted}`} />
      <CompetitionPicker value={c.slug} onChange={(s) => setParams({ competition: s })} />
      {data.standings.length === 0 ? (
        <Notice tone="info">No race results have been published for this competition yet.</Notice>
      ) : (
        <Card>
          <ExportBar csv={[[`/api/championship/export.csv?${q}`, "CSV"]]} whatsappPath={`/api/championship/whatsapp?${q}`} />
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Fancier</th>
                  <th className="num">Total</th>
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
                {data.standings.map((s) => (
                  <tr key={s.fancierId}>
                    <td className="num text-muted">{s.rank}</td>
                    <td>
                      <FancierLink id={s.fancierId} name={s.fancierName} />
                    </td>
                    <td className="num text-base font-bold">{s.total}</td>
                    {data.races.map((r) => {
                      const v = s.perRace[String(r.id)] ?? 0;
                      const isCounted = s.countedRaceIds.includes(String(r.id));
                      return (
                        <td key={r.id} className={`num ${isCounted ? "" : "text-muted line-through"}`}>
                          {v || "–"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {c.racesCounted === "best" && <p className="mt-2 text-xs text-muted">Struck-through scores are not counted (best {c.bestX}).</p>}
        </Card>
      )}
    </>
  );
}
