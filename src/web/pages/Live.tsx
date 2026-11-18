import { useState } from "react";
import { fmtDateTime } from "../format";
import { useApi } from "../hooks";
import { ScoreTable, FullResult } from "../results";
import type { LiveData } from "../types";
import { Card, ErrorBox, Loading, Notice, PageTitle, Tabs } from "../ui";

export function LivePage() {
  // The server polls Benzing every 5 minutes during a race; the page re-reads our API every minute.
  const { data, error } = useApi<LiveData>("/api/live", 60_000);
  const [tab, setTab] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (data.races.length === 0) {
    return (
      <>
        <PageTitle title="Live race" />
        <Notice tone="info">No race is live right now. On race day this page updates automatically as birds clock.</Notice>
      </>
    );
  }
  return (
    <>
      {data.races.map((r) => (
        <div key={r.race.id} className="mb-6">
          <PageTitle
            title={r.race.name}
            sub={
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-live" /> Live · {r.arrivals.length} of {r.race.basketed ?? "?"} home · updated {fmtDateTime(r.dataAsOf)}
              </span>
            }
          />
          <Notice>Provisional standings from live clockings. Official results are published after the race is evaluated and checked.</Notice>
          <div className="mt-4">
            {(() => {
              const current = tab ?? r.provisional[0]?.competition.slug ?? "arrivals";
              const prov = r.provisional.find((p) => p.competition.slug === current);
              return (
                <>
                  <Tabs
                    value={current}
                    onChange={setTab}
                    tabs={[...r.provisional.map((p): [string, string] => [p.competition.slug, p.competition.name.replace(/ championship$/i, "")]), ["arrivals", "Arrivals"]]}
                  />
                  <Card>
                    {r.arrivals.length === 0 ? (
                      <p className="text-sm text-muted">No birds clocked yet.</p>
                    ) : prov ? (
                      <ScoreTable calc={prov.result} rules={prov.competition.rules} />
                    ) : (
                      <FullResult rows={r.arrivals} />
                    )}
                  </Card>
                </>
              );
            })()}
          </div>
          <p className="mt-2 text-xs text-muted">Benzing is checked every {data.pollIntervalMinutes} minutes during a race.</p>
        </div>
      ))}
    </>
  );
}
