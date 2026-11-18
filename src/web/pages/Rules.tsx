import { useApi } from "../hooks";
import type { CompetitionInfo } from "../types";
import { Card, PageTitle, TableWrap } from "../ui";

const GLENN = [
  { full: 5, scoring: 5, points: 28 },
  { full: 8, scoring: 8, points: 25 },
  { full: 9, scoring: 9, points: 24 },
  { full: 10, scoring: 10, points: 23 },
  { full: 11, scoring: 11, points: 22 },
];

export function RulesPage() {
  const { data: comps } = useApi<CompetitionInfo[]>("/api/competitions");
  const five = comps?.find((c) => c.system === "top-n-per-fancier") ?? null;
  const data = five;
  const x = Number(five?.params.scoringBirds ?? 5);
  return (
    <>
      <PageTitle title="Rules" sub="How the club's results and championships are worked out" />
      <div className="space-y-4">
        {comps && comps.length > 1 && (
          <Card title="Competitions">
            <ul className="space-y-2 text-sm">
              {comps.map((c) => (
                <li key={c.slug}>
                  <strong>{c.name}</strong>: {c.rules} {c.racesCounted === "best" ? `Best ${c.bestX} races count.` : "All counted races count."}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <h2 className="pt-2 text-lg font-semibold">{five?.name ?? "5-bird championship"}</h2>
        <Card title="For each race">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
            <li>We start from Benzing's <strong>full result</strong>: every bird that came home, fastest (highest m/min) first. Benzing's own points and championships are not used.</li>
            <li>For each fancier we keep only their <strong>first {x} birds home</strong>, however late they arrive. Every other bird is removed.</li>
            <li>The remaining <em>scoring birds</em> are ranked again by speed. If there are N scoring birds, the fastest gets <strong>N points</strong>, the next N − 1, down to <strong>1 point</strong> for the slowest.</li>
            <li>A fancier's race score is the total of their scoring birds' points.</li>
            <li><strong>Equal speeds:</strong> no two birds share a place. Birds with exactly the same speed keep the order Benzing lists them in.</li>
            <li><strong>Disqualified birds</strong> are removed before scoring, so that fancier's next bird home moves up into their {x}.</li>
            <li>Results are checked by the club before they are published.</li>
          </ol>
        </Card>
        <Card title="Season championship">
          <p className="text-sm leading-relaxed">
            Your championship total is the sum of your race scores over {data?.racesCounted === "best" ? `your best ${data.bestX} races` : "all counted races"}. Training flights and tosses don't count. Fanciers on equal totals share a place.
          </p>
        </Card>
        <Card title="Worked example: Mooi River, 4 July 2026">
          <p className="mb-3 text-sm leading-relaxed">
            372 birds basketed, 265 home, 7 fanciers. Keeping each fancier's first 5 birds leaves <strong>32 scoring birds</strong>, so the fastest scores 32 points and the slowest 1.
            Glenn Mcewan's first five birds were 5th, 8th, 9th, 10th and 11th in the full result. The birds ahead of them all belonged to fanciers who still had birds to count, so these are also his places among the scoring birds:
          </p>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Place in full result</th>
                  <th className="num">Place among scoring birds</th>
                  <th className="num">Points (32 − place + 1)</th>
                </tr>
              </thead>
              <tbody>
                {GLENN.map((g) => (
                  <tr key={g.full}>
                    <td className="num">{g.full}</td>
                    <td className="num">{g.scoring}</td>
                    <td className="num font-semibold">{g.points}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} className="text-right font-semibold">
                    Race score
                  </td>
                  <td className="num text-base font-bold">122</td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-3 text-sm text-muted">
            Further down it changes: Wesley Phillips' 3rd bird was 15th in the full result, but only 13th among scoring birds. The birds at 12 and 13 were Glenn's 6th and 7th, which don't count. So it scored 20 points.
          </p>
        </Card>
      </div>
    </>
  );
}
