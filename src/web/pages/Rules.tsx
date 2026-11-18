import { useApi } from "../hooks";
import type { CompetitionInfo } from "../types";
import { Card, PageTitle, TableWrap } from "../ui";

/** Glenn Mcewan at Mooi River 2026: places in the full result and among the 32 scoring birds. */
const GLENN = [
  { full: 5, scoring: 5 },
  { full: 8, scoring: 8 },
  { full: 9, scoring: 9 },
  { full: 10, scoring: 10 },
  { full: 11, scoring: 11 },
];
/** In 2026 the first race (Matatiele 1) had 36 scoring birds; Mooi River itself had 32. */
const BASE_2026 = 36;
const MOOI_N = 32;

export function RulesPage() {
  const { data: comps } = useApi<CompetitionInfo[]>("/api/competitions");
  const five = comps?.find((c) => c.system === "top-n-per-fancier") ?? null;
  const data = five;
  const x = Number(five?.params.scoringBirds ?? 5);
  const scale = String(five?.params.scale ?? "race");
  const firstRace = scale === "first-race";
  const fixed = scale === "fixed";
  const maxPoints = Number(five?.params.maxPoints ?? 0);
  const scaleN = fixed ? maxPoints : firstRace ? BASE_2026 : MOOI_N;
  const glenn = GLENN.map((g) => ({ ...g, points: Math.max(0, scaleN - g.scoring + 1) }));
  const glennTotal = glenn.reduce((sum, g) => sum + g.points, 0);
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
            {fixed ? (
              <li>
                The remaining <em>scoring birds</em> are ranked again by speed. The fastest scoring bird in <em>every</em> race gets{" "}
                <strong>{maxPoints} points</strong>, the next {maxPoints - 1}, and so on, one point less per bird. A win is worth the same in every race; scoring birds
                placed beyond {maxPoints} get 0.
              </li>
            ) : firstRace ? (
              <li>
                The remaining <em>scoring birds</em> are ranked again by speed. <strong>The season's first race sets the points:</strong> if it had N scoring birds, the
                fastest scoring bird in <em>every</em> race gets <strong>N points</strong>, the next N − 1, and so on. A win is worth the same in every race; in a smaller
                race the last scoring bird simply gets more than 1, and in a bigger race scoring birds placed beyond N get 0.
              </li>
            ) : (
              <li>The remaining <em>scoring birds</em> are ranked again by speed. If there are N scoring birds, the fastest gets <strong>N points</strong>, the next N − 1, down to <strong>1 point</strong> for the slowest.</li>
            )}
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
            372 birds basketed, 265 home, 7 fanciers. Keeping each fancier's first 5 birds leaves <strong>32 scoring birds</strong>.{" "}
            {fixed ? (
              <>
                The fastest scoring bird scores {maxPoints}, the next {maxPoints - 1}, and Mooi River's 32nd (last) scoring bird scores {Math.max(0, maxPoints - 31)}.
              </>
            ) : firstRace ? (
              <>
                The 2026 scale comes from the first race, Matatiele 1, which had <strong>36 scoring birds</strong>: so the fastest scoring bird scores 36, the next 35,
                and Mooi River's 32nd (last) scoring bird scores 5.
              </>
            ) : (
              <>So the fastest scores 32 points and the slowest 1.</>
            )}
            Glenn Mcewan's first five birds were 5th, 8th, 9th, 10th and 11th in the full result. The birds ahead of them all belonged to fanciers who still had birds to count, so these are also his places among the scoring birds:
          </p>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Place in full result</th>
                  <th className="num">Place among scoring birds</th>
                  <th className="num">Points ({scaleN} − place + 1)</th>
                </tr>
              </thead>
              <tbody>
                {glenn.map((g) => (
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
                  <td className="num text-base font-bold">{glennTotal}</td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-3 text-sm text-muted">
            Further down it changes: Wesley Phillips' 3rd bird was 15th in the full result, but only 13th among scoring birds. The birds at 12 and 13 were Glenn's 6th and 7th, which don't count. So it scored {Math.max(0, scaleN - 13 + 1)} points.
          </p>
        </Card>
        <p className="no-print pt-2 text-center text-xs text-muted">
          {/* Full page load (not an in-app link) so Cloudflare Access can ask for the admin login. */}
          <a href="/admin" className="underline underline-offset-2">
            Club admin
          </a>
        </p>
      </div>
    </>
  );
}
