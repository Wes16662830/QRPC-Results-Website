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
  return (
    <>
      <PageTitle title={data.fancier.name} sub={`${data.season} season`} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Championship" value={data.standing ? `${data.standing.rank} of ${data.standing.of}` : "–"} />
        <Stat label="Points" value={data.standing?.total ?? 0} />
        <Stat label="Basketed / home" value={`${data.totals.basketed} / ${data.totals.returned}`} />
        <Stat label="Return" value={data.totals.returnPct === null ? "–" : `${data.totals.returnPct}%`} />
      </div>
      <Card title="Races">
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Race</th>
                <th className="num">Basketed</th>
                <th className="num">Home</th>
                <th>Scoring birds (place in full result → points)</th>
                <th className="num">Points</th>
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
                  <td className="text-muted">{r.fiveBird ? r.fiveBird.birds.map((b) => `${b.benzingPosition}→${b.points}`).join(", ") || "none" : "not published"}</td>
                  <td className="num font-semibold">{r.fiveBird ? r.fiveBird.score : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
