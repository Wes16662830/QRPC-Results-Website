import { Link } from "react-router";
import { fmtDate, fmtSpeed } from "../format";
import { useApi } from "../hooks";
import { useSeason } from "../season";
import type { Home } from "../types";
import { Card, ErrorBox, FancierLink, Loading, PageTitle, StateBadge } from "../ui";

export function HomePage() {
  const { season } = useSeason();
  const { data, error } = useApi<Home>(season ? `/api/home?season=${season}` : null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const latest = data.latestRace;

  return (
    <>
      <PageTitle title={`${data.season} season`} sub="Queenstown Racing Pigeon Club" />

      {data.liveRaces.length > 0 && (
        <Link to="/live" className="mb-4 flex items-center justify-between rounded-xl bg-live px-4 py-3 font-semibold text-white">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            {data.liveRaces[0]!.name} is live – {data.liveRaces[0]!.arrivals} birds home
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="Latest result"
          right={
            latest && (
              <span className="flex items-center gap-2">
                <Link to="/leaderboard" className="text-sm text-muted underline">
                  Leaderboard
                </Link>
                <StateBadge state={latest.race.state} />
              </span>
            )
          }
        >
          {latest ? (
            <>
              <Link to={`/races/${latest.race.id}`} className="text-lg font-semibold underline decoration-line underline-offset-4">
                {latest.race.name}
              </Link>
              <p className="mb-3 text-sm text-muted">
                {fmtDate(latest.race.date)} · {latest.race.basketed} basketed · {latest.returned} home
              </p>
              {latest.firstBird && (
                <p className="mb-3 text-sm">
                  First bird: <strong>{latest.firstBird.fancierName}</strong> at {fmtSpeed(latest.firstBird.speed)} m/min
                </p>
              )}
              <ol className="space-y-1.5">
                {latest.top.map((f) => (
                  <li key={f.fancierId} className="flex justify-between text-sm">
                    <span>
                      <span className="inline-block w-6 text-muted">{f.rank ?? "="}</span>
                      <FancierLink id={f.fancierId} name={f.fancierName} />
                    </span>
                    <span className="font-semibold">{f.score} pts</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-sm text-muted">No results published yet.</p>
          )}
        </Card>

        <Card title={`${data.competition.name}: top 5`} right={<Link to="/championship" className="text-sm text-muted underline">Full table</Link>}>
          {data.championshipTop5.length ? (
            <>
              <ol className="space-y-1.5">
                {data.championshipTop5.map((s) => (
                  <li key={s.fancierId} className="flex justify-between text-sm">
                    <span>
                      <span className="inline-block w-6 text-muted">{s.rank}</span>
                      <FancierLink id={s.fancierId} name={s.fancierName} />
                    </span>
                    <span className="font-semibold">{s.total} pts</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted">After {data.racesCounted} published race{data.racesCounted === 1 ? "" : "s"}.</p>
            </>
          ) : (
            <p className="text-sm text-muted">No races published yet.</p>
          )}
        </Card>

        <Card title="Next race">
          {data.nextRace ? (
            <>
              <Link to={`/races/${data.nextRace.id}`} className="text-lg font-semibold">{data.nextRace.name}</Link>
              <p className="text-sm text-muted">
                {fmtDate(data.nextRace.date)}
                {data.nextRace.liberationTime && ` · liberation ${data.nextRace.liberationTime.slice(0, 5)}`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">No upcoming race for {data.season} in Benzing yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
