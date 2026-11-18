import { Link } from "react-router";
import { useApi } from "../hooks";
import { ExportBar } from "../share";
import type { Championship } from "../types";
import { Card, ErrorBox, FancierLink, Loading, Notice, PageTitle, TableWrap } from "../ui";

export function ChampionshipPage() {
  const { data, error } = useApi<Championship>("/api/championship");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const counted = data.settings.racesCounted === "all" ? "all races count" : `best ${data.settings.bestX} races count`;
  return (
    <>
      <PageTitle title={`${data.season} 5-bird championship`} sub={`${data.races.length} published races · ${counted}`} />
      {data.standings.length === 0 ? (
        <Notice tone="info">No race results have been published yet.</Notice>
      ) : (
        <Card>
          <ExportBar csv={[[`/api/championship/export.csv?season=${data.season}`, "CSV"]]} whatsappPath={`/api/championship/whatsapp?season=${data.season}`} />
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
          {data.settings.racesCounted === "best" && <p className="mt-2 text-xs text-muted">Struck-through scores are not counted (best {data.settings.bestX}).</p>}
        </Card>
      )}
    </>
  );
}
