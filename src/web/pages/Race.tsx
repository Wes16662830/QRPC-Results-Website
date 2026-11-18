import { useState } from "react";
import { useParams } from "react-router";
import { fmtArrival, fmtDate, fmtDateTime, fmtKm, fmtSpeed } from "../format";
import { useApi } from "../hooks";
import { EntriesTable, FiveBirdResult, FullResult, ScoringBirds } from "../results";
import { ExportBar } from "../share";
import type { RaceDetail } from "../types";
import { Card, ErrorBox, Loading, Notice, PageTitle, Stat, StateBadge, Tabs } from "../ui";

type Tab = "five" | "full" | "details";

export function RacePage() {
  const { id } = useParams();
  const { data, error } = useApi<RaceDetail>(`/api/races/${id}`);
  const rules = useApi<{ scoringBirds: number }>("/api/rules");
  const [tab, setTab] = useState<Tab>("five");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { race } = data;
  const scoring = new Set(data.fiveBird?.lines.map((l) => l.ring) ?? []);

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
        <Stat label="Distance" value={fmtKm(race.minDistanceKm)} />
      </div>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[["five", "5-bird result"], ["full", "Full result"], ["details", "Details"]]} />

      {tab === "five" && (
        <Card>
          {data.fiveBird ? (
            <>
              <ExportBar csv={[[`/api/races/${race.id}/five-bird.csv`, "CSV"]]} whatsappPath={`/api/races/${race.id}/whatsapp`} />
              <FiveBirdResult calc={data.fiveBird} scoringBirds={rules.data?.scoringBirds} />
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold">All {data.fiveBird.n} scoring birds</summary>
                <div className="mt-3">
                  <ScoringBirds calc={data.fiveBird} />
                </div>
              </details>
              <p className="mt-4 text-xs text-muted">Published {fmtDateTime(data.fiveBird.publishedAt)}.</p>
            </>
          ) : (
            <Notice tone="info">
              {race.state === "draft"
                ? "The 5-bird result is being checked by the club and will appear here once published."
                : "The 5-bird result will appear here after the race has been evaluated and published."}
            </Notice>
          )}
        </Card>
      )}

      {tab === "full" && (
        <Card>
          {data.fullResult.length ? (
            <>
              <ExportBar csv={[[`/api/races/${race.id}/full.csv`, "CSV"]]} />
              <FullResult rows={data.fullResult} highlight={scoring.size ? scoring : undefined} />
            </>
          ) : (
            <Notice tone="info">The full result has not been imported yet.</Notice>
          )}
        </Card>
      )}

      {tab === "details" && (
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
