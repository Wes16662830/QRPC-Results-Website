import { Link, useParams } from "react-router";
import { fmtDate } from "../format";
import { useApi } from "../hooks";
import type { FancierDetail } from "../types";
import { Card, ErrorBox, Loading, PageTitle, Stat, TableWrap } from "../ui";

export function FancierPage() {
  const { id } = useParams();
  const { data, error } = useApi<FancierDetail>(`/api/fanciers/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const main = data.standings[0];
  const comps = data.competitions;
  return (
    <>
      <PageTitle title={data.fancier.name} sub={`${data.season} season`} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={main?.competition.name ?? "Championship"} value={main?.rank ? `${main.rank} of ${main.of}` : "–"} />
        <Stat label="Points" value={main?.total ?? 0} />
        <Stat label="Basketed / home" value={`${data.totals.basketed} / ${data.totals.returned}`} />
        <Stat label="Return" value={data.totals.returnPct === null ? "–" : `${data.totals.returnPct}%`} />
      </div>
      {data.standings.length > 1 && (
        <Card title="Competitions" className="mb-4">
          <ul className="divide-y divide-line text-sm">
            {data.standings.map((s) => (
              <li key={s.competition.slug} className="flex justify-between py-2">
                <Link to={`/championship?competition=${s.competition.slug}`} className="underline decoration-line underline-offset-2">
                  {s.competition.name}
                </Link>
                <span>
                  {s.rank ? `${s.rank} of ${s.of}` : "–"} · <strong>{s.total} pts</strong>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Races">
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Race</th>
                <th className="num">Basketed</th>
                <th className="num">Home</th>
                {comps.length === 1 && <th>Scoring birds (place → points)</th>}
                {comps.map((c) => (
                  <th key={c.slug} className="num">
                    {comps.length === 1 ? "Points" : c.name.replace(/ championship$/i, "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.races.map((r) => (
                <tr key={r.raceId}>
                  <td>
                    <Link to={`/races/${r.raceId}`} className="font-medium underline decoration-line underline-offset-2">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {fmtDate(r.date)}
                      {r.kind === "training" ? " · training" : !r.included ? " · not counted" : ""}
                    </div>
                  </td>
                  <td className="num">{r.basketed}</td>
                  <td className="num">{r.returned}</td>
                  {comps.length === 1 && (
                    <td className="text-muted">
                      {(() => {
                        const res = r.results[comps[0]!.slug];
                        return res ? res.birds.map((b) => `${b.benzingPosition}→${b.points}`).join(", ") || "none" : "not published";
                      })()}
                    </td>
                  )}
                  {comps.map((c) => (
                    <td key={c.slug} className="num font-semibold">
                      {r.results[c.slug]?.score ?? "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
