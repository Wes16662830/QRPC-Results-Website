import { Link } from "react-router";
import { fmtDate, fmtKm } from "../format";
import { useApi } from "../hooks";
import { useSeason } from "../season";
import type { RaceSummary } from "../types";
import { ErrorBox, Loading, PageTitle, StateBadge } from "../ui";

function RaceList({ races }: { races: RaceSummary[] }) {
  return (
    <ul className="card divide-y divide-line">
      {races.map((r) => (
        <li key={r.id}>
          <Link to={`/races/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {r.number ? <span className="mr-1.5 text-muted">#{r.number}</span> : null}
                {r.name}
              </div>
              <div className="text-sm text-muted">
                {fmtDate(r.date)} · {fmtKm(r.minDistanceKm)} · {r.basketed ?? 0} birds
              </div>
            </div>
            <StateBadge state={r.state} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RacesPage() {
  const { season } = useSeason();
  const { data, error } = useApi<RaceSummary[]>(season ? `/api/races?season=${season}` : null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const races = data.filter((r) => r.kind === "race");
  const trainings = data.filter((r) => r.kind === "training");
  return (
    <>
      <PageTitle title={`Races ${season}`} sub={`${races.length} races · ${trainings.length} training/tosses`} />
      {data.length === 0 && <p className="text-sm text-muted">No races for {season} yet.</p>}
      <RaceList races={races} />
      {trainings.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Training and tosses</h2>
          <RaceList races={trainings} />
        </>
      )}
    </>
  );
}
