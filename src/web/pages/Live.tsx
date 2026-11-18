import { useState } from "react";
import { fmtDateTime } from "../format";
import { useApi } from "../hooks";
import { FiveBirdResult, FullResult } from "../results";
import type { LiveData } from "../types";
import { Card, ErrorBox, Loading, Notice, PageTitle, Tabs } from "../ui";

export function LivePage() {
  // The server polls Benzing every 5 minutes during a race; the page re-reads our API every minute.
  const { data, error } = useApi<LiveData>("/api/live", 60_000);
  const [tab, setTab] = useState<"five" | "arrivals">("five");
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
          <Notice>Provisional standings from live clockings. The official 5-bird result is published after the race is evaluated.</Notice>
          <div className="mt-4">
            <Tabs value={tab} onChange={setTab} tabs={[["five", "Provisional 5-bird"], ["arrivals", "Arrivals"]]} />
            <Card>
              {r.arrivals.length === 0 ? (
                <p className="text-sm text-muted">No birds clocked yet.</p>
              ) : tab === "five" ? (
                <FiveBirdResult calc={r.provisional} />
              ) : (
                <FullResult rows={r.arrivals} />
              )}
            </Card>
          </div>
          <p className="mt-2 text-xs text-muted">Benzing is checked every {data.pollIntervalMinutes} minutes during a race.</p>
        </div>
      ))}
    </>
  );
}
