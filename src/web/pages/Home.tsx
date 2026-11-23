import { Link } from "react-router";
import { fmtDate, fmtDuration, fmtPoints, fmtSpeed } from "../format";
import { useApi } from "../hooks";
import { useSeason } from "../season";
import type { Home, Margin, SeasonStats } from "../types";
import { Card, ErrorBox, FancierLink, Loading, PageTitle, Stat, StateBadge } from "../ui";

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

      {data.stats && <SeasonSoFar stats={data.stats} season={data.season} />}
    </>
  );
}

/** Winning margin in time: how much later the next fancier's bird would have arrived over the winner's distance. */
function MarginCard({ title, m, verb }: { title: string; m: Margin; verb: string }) {
  return (
    <Card title={title}>
      <p className="text-2xl font-bold">{fmtDuration(m.seconds)}</p>
      <p className="mt-1 text-sm">
        at{" "}
        <Link className="underline" to={`/races/${m.raceId}`}>
          {m.raceName}
        </Link>
        : {m.first} {verb} {m.second}
      </p>
      <p className="mt-1 text-xs text-muted">
        Over the winner's distance ({fmtSpeed(m.speedGap)} m/min faster). Lofts are at different distances, so this is how much later {m.second}'s best bird would have
        arrived flying the winner's distance.
      </p>
    </Card>
  );
}

/** "Season so far": fun facts from the published races. */
function SeasonSoFar({ stats, season }: { stats: SeasonStats; season: number }) {
  const medal = ["🥇", "🥈", "🥉"];
  return (
    <>
      <h2 className="mt-8 mb-3 text-lg font-bold">{season} so far</h2>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Races flown" value={stats.racesFlown} />
        <Stat label="Birds basketed" value={stats.basketed.toLocaleString("en-ZA")} />
        <Stat label="Birds home" value={stats.home.toLocaleString("en-ZA")} />
        <Stat label="Club return" value={stats.returnPct === null ? "–" : `${stats.returnPct}%`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {stats.bestBird && stats.bestBird.top.length > 0 && (
          <Card title="Best bird so far" right={<Link to={`/championship?competition=${stats.bestBird.slug}`} className="text-sm text-muted underline">Full table</Link>}>
            <ol className="space-y-2">
              {stats.bestBird.top.map((b) => (
                <li key={b.ring} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="mr-2">{medal[b.rank - 1] ?? b.rank}</span>
                    <span className="font-semibold">{b.ring}</span>
                    <span className="block pl-7 text-xs text-muted">{b.fancierName}</span>
                  </span>
                  <span className="font-bold whitespace-nowrap">{fmtPoints(b.total)} pts</span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {stats.fastest && (
          <Card title="Fastest bird of the season">
            <p className="text-2xl font-bold">
              {fmtSpeed(stats.fastest.speed)} <span className="text-base font-normal text-muted">m/min</span>
            </p>
            <p className="mt-1 text-sm">
              <strong>{stats.fastest.ring}</strong> · {stats.fastest.fancierName}
            </p>
            <p className="text-sm text-muted">
              at{" "}
              <Link className="underline" to={`/races/${stats.fastest.raceId}`}>
                {stats.fastest.raceName}
              </Link>
            </p>
          </Card>
        )}

        {stats.wins.length > 0 && (
          <Card title="Race wins" right={<span className="text-xs text-muted">first bird home</span>}>
            <ol className="space-y-1.5">
              {stats.wins.map((w, i) => (
                <li key={w.fancierName} className="flex justify-between text-sm">
                  <span>
                    <span className="mr-2">{medal[i]}</span>
                    {w.fancierName}
                  </span>
                  <span className="font-bold">
                    {w.wins} win{w.wins === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {stats.returnRate.length > 0 && (
          <Card title="Best return rate" right={<span className="text-xs text-muted">min. 10 basketed</span>}>
            <ol className="space-y-1.5">
              {stats.returnRate.map((r, i) => (
                <li key={r.fancierId} className="flex justify-between gap-3 text-sm">
                  <span>
                    <span className="mr-2">{medal[i]}</span>
                    <FancierLink id={r.fancierId} name={r.fancierName} />
                    <span className="ml-1 text-xs text-muted">
                      {r.returned}/{r.basketed}
                    </span>
                  </span>
                  <span className="font-bold">{r.pct}%</span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <Card title="Never missed a race" right={<span className="text-xs text-muted">home in all {stats.racesFlown}</span>}>
          {stats.everyRace.count === 0 ? (
            <p className="text-sm text-muted">No bird has come home in every race yet.</p>
          ) : (
            <>
              <p className="text-2xl font-bold">
                {stats.everyRace.count} <span className="text-base font-normal text-muted">bird{stats.everyRace.count === 1 ? "" : "s"}</span>
              </p>
              <ul className="mt-2 space-y-0.5 text-sm">
                {stats.everyRace.top.map((b) => (
                  <li key={b.ring}>
                    <span className="font-semibold">{b.ring}</span> <span className="text-muted">· {b.fancierName}</span>
                  </li>
                ))}
                {stats.everyRace.count > stats.everyRace.top.length && <li className="text-xs text-muted">…and {stats.everyRace.count - stats.everyRace.top.length} more</li>}
              </ul>
            </>
          )}
        </Card>

        {stats.closest && <MarginCard title="Closest finish" m={stats.closest} verb="just ahead of" />}
        {stats.biggest && stats.biggest.raceId !== stats.closest?.raceId && <MarginCard title="Biggest winning margin" m={stats.biggest} verb="ahead of" />}
      </div>
    </>
  );
}
