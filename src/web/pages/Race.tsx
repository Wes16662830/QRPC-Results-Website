import { useState } from "react";
import { useParams } from "react-router";
import { fmtArrival, fmtDate, fmtDateTime, fmtKm, fmtSpeed } from "../format";
import { useApi } from "../hooks";
import { CompetitionResultView, EntriesTable, FullResult, ScoringBirds } from "../results";
import { ExportBar } from "../share";
import type { RaceDetail } from "../types";
import { Card, ErrorBox, Loading, Notice, PageTitle, Stat, StateBadge, Tabs } from "../ui";

type Tab = string; // competition slug, "full" or "details"

export function RacePage() {
  const { id } = useParams();
  const { data, error } = useApi<RaceDetail>(`/api/races/${id}`);
  const [tab, setTab] = useState<Tab | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { race } = data;
  const current = tab ?? data.results[0]?.competition.slug ?? "full";
  const main = data.results[0]?.published;
  const scoring = new Set(main?.lines.map((l) => l.ring) ?? []);
  const compResult = data.results.find((r) => r.competition.slug === current);

  return (
    <>
      <PageTitle
        title={race.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {fmtDate(race.date)}
            {race.number ? ` · Race ${race.number}` : ""} <StateBadge state={race.state} />
          </span>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Basketed" value={race.basketed ?? "–"} />
        <Stat label="Home" value={data.returned || "–"} />
        <Stat label="Fanciers" value={race.fanciers ?? "–"} />
        <Stat
          label="Distance"
          value={race.minDistanceKm && race.maxDistanceKm && Math.round(race.maxDistanceKm) !== Math.round(race.minDistanceKm) ? `${Math.round(race.minDistanceKm)}–${Math.round(race.maxDistanceKm)} km` : fmtKm(race.minDistanceKm)}
        />
      </div>

      <Tabs<Tab>
        value={current}
        onChange={setTab}
        tabs={[...data.results.map((r): [string, string] => [r.competition.slug, r.competition.name.replace(/ championship$/i, "")]), ["full", "Full result"], ["details", "Details"]]}
      />

      {compResult && (
        <Card>
          {compResult.published ? (
            <>
              <ExportBar
                csv={[[`/api/races/${race.id}/result.csv?competition=${compResult.competition.slug}`, "CSV"]]}
                whatsappPath={`/api/races/${race.id}/whatsapp?competition=${compResult.competition.slug}`}
              />
              <CompetitionResultView calc={compResult.published} competition={compResult.competition} />
              {compResult.competition.entity === "fancier" && compResult.competition.unit === "Points" && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold">All {compResult.published.n} scoring birds</summary>
                <div className="mt-3">
                  <ScoringBirds calc={compResult.published} />
                </div>
              </details>
              )}
              <p className="mt-4 text-xs text-muted">Published {fmtDateTime(compResult.published.publishedAt)}.</p>
            </>
          ) : (
            <Notice tone="info">
              {race.state === "draft"
                ? `The ${compResult.competition.name} result is being checked by the club and will appear here once published.`
                : `The ${compResult.competition.name} result will appear here after the race has been evaluated and published.`}
            </Notice>
          )}
        </Card>
      )}

      {current === "full" && (
        <Card>
          {data.fullResult.length ? (
            <>
              <ExportBar csv={[[`/api/races/${race.id}/full.csv`, "CSV"]]} />
              <FullResult rows={data.fullResult} highlight={scoring.size ? scoring : undefined} highlightLabel={data.results[0]?.competition.name} />
            </>
          ) : (
            <Notice tone="info">The full result has not been imported yet.</Notice>
          )}
        </Card>
      )}

      {current === "details" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Race details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Liberation point</dt>
              <dd>{data.liberationPoint}</dd>
              <dt className="text-muted">Liberation</dt>
              <dd>{race.liberationTime ? `${fmtDate(race.date)}, ${race.liberationTime.slice(0, 5)} SAST` : fmtDate(race.date)}</dd>
              <dt className="text-muted">Distances</dt>
              <dd>
                {fmtKm(race.minDistanceKm)} – {fmtKm(race.maxDistanceKm)}
              </dd>
              <dt className="text-muted">Basketed / home</dt>
              <dd>
                {race.basketed ?? "–"} / {data.returned}
              </dd>
              {data.firstBird && (
                <>
                  <dt className="text-muted">First bird</dt>
                  <dd>
                    {data.firstBird.fancierName}, {fmtArrival(data.firstBird.arrivalDay, data.firstBird.arrivalTime)}, {fmtSpeed(data.firstBird.speed)} m/min
                  </dd>
                </>
              )}
              {data.lastBird && (
                <>
                  <dt className="text-muted">Last bird</dt>
                  <dd>
                    {data.lastBird.fancierName}, {fmtArrival(data.lastBird.arrivalDay, data.lastBird.arrivalTime)}, {fmtSpeed(data.lastBird.speed)} m/min
                  </dd>
                </>
              )}
              <dt className="text-muted">Data from Benzing</dt>
              <dd>{fmtDateTime(data.sheetFetchedAt)}</dd>
            </dl>
          </Card>
          <Card title="Basketed and returned">{data.entries.length ? <EntriesTable detail={data} /> : <p className="text-sm text-muted">Not available yet.</p>}</Card>
        </div>
      )}
    </>
  );
}
