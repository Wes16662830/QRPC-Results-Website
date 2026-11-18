import { useState } from "react";
import { Link, NavLink, Route, Routes, useParams } from "react-router";
import { ApiError, post } from "../api";
import { fmtDate, fmtDateTime } from "../format";
import { useApi } from "../hooks";
import { ChampionshipPage } from "../pages/Championship";
import { ScoreTable } from "../results";
import type { AdminRaceDetail, CompetitionInfo, CompetitionResult, RaceSummary } from "../types";
import { Card, ErrorBox, Loading, Notice, PageTitle, StateBadge, TableWrap } from "../ui";

interface Overview {
  actor: string;
  alerts: { id: number; at: string; level: string; source: string; race_id: number | null; message: string }[];
  drafts: { id: number; race_id: number; name: string; created_at: string }[];
  lastRaceSync: string | null;
  lastLivePoll: string | null;
  memberPasswordSet: boolean;
  season: number;
  seasons: number[];
}

/** Runs an admin action, showing progress and the result or error. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, okText: string | ((r: unknown) => string)) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: typeof okText === "string" ? okText : okText(r) });
      return r;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }
  const view = msg ? <div className={`mt-2 text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</div> : null;
  return { busy, run, view };
}

export function AdminApp() {
  const overview = useApi<Overview>("/api/admin/overview");
  if (overview.error) {
    return (
      <>
        <PageTitle title="Admin" />
        <ErrorBox error={overview.error} />
        {overview.error.status === 401 && <p className="mt-3 text-sm text-muted">Admin is reached through Cloudflare Access at /admin. Try a private window; if this keeps happening, send the message above to whoever maintains the site.</p>}
      </>
    );
  }
  if (!overview.data) return <Loading />;
  return (
    <>
      <nav className="no-print mb-4 flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1 text-sm font-semibold">
        {[
          ["/admin", "Overview"],
          ["/admin/races", "Races"],
          ["/admin/standings", "Standings"],
          ["/admin/settings", "Settings"],
          ["/admin/audit", "Audit log"],
        ].map(([to, label]) => (
          <NavLink key={to} to={to!} end className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-2 ${isActive ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
            {label}
          </NavLink>
        ))}
        <Link to="/" className="ml-auto whitespace-nowrap px-3 py-2 text-muted">
          ← Site
        </Link>
      </nav>
      <Routes>
        <Route index element={<OverviewPage o={overview.data} reload={overview.reload} />} />
        <Route path="races" element={<AdminRaces season={overview.data.season} />} />
        <Route path="races/:id" element={<AdminRace />} />
        <Route path="standings" element={<ChampionshipPage admin />} />
        <Route path="settings" element={<SettingsPage season={overview.data.season} passwordSet={overview.data.memberPasswordSet} />} />
        <Route path="audit" element={<AuditPage />} />
      </Routes>
    </>
  );
}

function OverviewPage({ o, reload }: { o: Overview; reload: () => void }) {
  const [season, setSeason] = useState(o.season || new Date().getFullYear());
  const sync = useAction();
  return (
    <>
      <PageTitle title="Admin" sub={`Signed in as ${o.actor} (Cloudflare Access)`} />
      {!o.memberPasswordSet && (
        <div className="mb-4">
          <Notice>
            Members can't sign in yet. <Link to="/admin/settings" className="underline">Set the club password</Link>.
          </Notice>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Benzing">
          <p className="text-sm text-muted">Last race-list sync: {fmtDateTime(o.lastRaceSync)}</p>
          <p className="mb-3 text-sm text-muted">Last live poll: {fmtDateTime(o.lastLivePoll)}</p>
          <div className="flex gap-2">
            <input className="input max-w-28" type="number" value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-label="Season" />
            <button
              className="btn btn-primary"
              disabled={sync.busy}
              onClick={() =>
                sync.run(
                  async () => {
                    const r = await post<{ races: number; trainings: number }>("/api/admin/sync-races", { season });
                    reload();
                    return r;
                  },
                  (r) => {
                    const x = r as { races: number; trainings: number };
                    return `Synced ${x.races} races and ${x.trainings} training/tosses.`;
                  },
                )
              }
            >
              {sync.busy ? "Syncing…" : "Sync races"}
            </button>
          </div>
          {sync.view}
          <p className="mt-3 text-xs text-muted">Reads the season's race list from Benzing. Results are only fetched when you press Calculate results on a race.</p>
        </Card>
        <Card title={`Drafts waiting to publish (${o.drafts.length})`}>
          {o.drafts.length ? (
            <ul className="space-y-1 text-sm">
              {o.drafts.map((d) => (
                <li key={d.id}>
                  <Link className="underline" to={`/admin/races/${d.race_id}`}>
                    {d.name}
                  </Link>{" "}
                  <span className="text-muted">· {fmtDateTime(d.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing waiting.</p>
          )}
        </Card>
      </div>
      <Card title={`Alerts (${o.alerts.length})`} className="mt-4">
        {o.alerts.length ? (
          <ul className="space-y-2">
            {o.alerts.map((a) => (
              <li key={a.id} className={`flex items-start justify-between gap-3 rounded-lg p-3 text-sm ${a.level === "error" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>
                <span>
                  <strong className="uppercase">{a.level}</strong> · {fmtDateTime(a.at)}
                  <br />
                  {a.message} {a.race_id && <Link className="underline" to={`/admin/races/${a.race_id}`}>Open race</Link>}
                </span>
                <button
                  className="btn"
                  onClick={async () => {
                    await post(`/api/admin/alerts/${a.id}/resolve`);
                    reload();
                  }}
                >
                  Resolve
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No open alerts.</p>
        )}
      </Card>
    </>
  );
}

type BulkLine = { name: string; ok: boolean | null; text: string };

/** Runs an admin action race by race (one request each, so free-plan limits apply per race). */
function BulkPanel({ lines, running, title }: { lines: BulkLine[]; running: boolean; title: string }) {
  if (!lines.length) return null;
  return (
    <Card title={running ? `${title}…` : title} className="mb-4">
      <ul className="space-y-1 text-sm">
        {lines.map((l) => (
          <li key={l.name} className={l.ok === null ? "text-muted" : l.ok ? "text-good" : "text-warn"}>
            {l.ok === null ? "⏳" : l.ok ? "✓" : "!"} <strong>{l.name}</strong> – {l.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AdminRaces({ season }: { season: number }) {
  const { data, error, reload } = useApi<RaceSummary[]>(`/api/admin/races?season=${season}`);
  const recalc = useAction();
  const [bulk, setBulk] = useState<{ title: string; lines: BulkLine[]; running: boolean }>({ title: "", lines: [], running: false });

  async function runBulk(title: string, races: RaceSummary[], step: (r: RaceSummary) => Promise<{ ok: boolean; text: string }>) {
    const lines: BulkLine[] = races.map((r) => ({ name: r.name, ok: null, text: "waiting" }));
    setBulk({ title, lines: [...lines], running: true });
    for (let i = 0; i < races.length; i++) {
      lines[i] = { name: races[i]!.name, ok: null, text: "working…" };
      setBulk({ title, lines: [...lines], running: true });
      try {
        lines[i] = { name: races[i]!.name, ...(await step(races[i]!)) };
      } catch (e) {
        lines[i] = { name: races[i]!.name, ok: false, text: (e as Error).message };
      }
      setBulk({ title, lines: [...lines], running: true });
    }
    setBulk({ title, lines, running: false });
    await reload();
  }

  const toCalculate = (data ?? []).filter((r) => r.kind === "race" && !r.calculated && r.state !== "upcoming");
  const toPublish = (data ?? []).filter((r) => r.draftWaiting);

  const calculateAll = () =>
    runBulk("Calculate all", toCalculate, async (r) => {
      const res = await post<{ changed: boolean; warnings: string[]; drafts: { skipped?: string }[] }>(`/api/admin/races/${r.id}/calculate`);
      const skipped = res.drafts.filter((d) => d.skipped).length;
      const notes = [
        res.warnings.length ? `${res.warnings.length} note${res.warnings.length > 1 ? "s" : ""}` : "",
        skipped ? `${skipped} competition${skipped > 1 ? "s" : ""} need a closing time set on the race page` : "",
      ].filter(Boolean);
      return { ok: true, text: `${res.changed ? "draft created" : "no change since last calculation"}${notes.length ? ` (${notes.join("; ")})` : ""}` };
    });

  const publishAll = () =>
    runBulk("Publish all", toPublish, async (r) => {
      try {
        await post(`/api/admin/races/${r.id}/publish`, { acknowledgeWarnings: false });
        return { ok: true, text: "published" };
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return { ok: false, text: "has warnings – open the race, review and publish it there" };
        throw e;
      }
    });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const update = async (id: number, patch: Record<string, unknown>) => {
    await post(`/api/admin/races/${id}`, patch);
    reload();
  };
  return (
    <>
      <PageTitle
        title={`Races ${season}`}
        actions={
          <>
          <button className="btn btn-primary" disabled={bulk.running || toCalculate.length === 0} onClick={calculateAll} title="Import and calculate every race that has no results yet">
            Calculate all{toCalculate.length ? ` (${toCalculate.length})` : ""}
          </button>
          <button className="btn btn-primary" disabled={bulk.running || toPublish.length === 0} onClick={publishAll} title="Publish every race that has a draft waiting">
            Publish all{toPublish.length ? ` (${toPublish.length})` : ""}
          </button>
          <button className="btn" disabled={recalc.busy || bulk.running} onClick={() => recalc.run(() => post<{ changed: boolean }[]>("/api/admin/recalculate-season", { season }), (r) => `${(r as { changed: boolean }[]).filter((x) => x.changed).length} new drafts to review.`)}>
            Recalculate season
          </button>
          </>
        }
      />
      {recalc.view}
      <BulkPanel lines={bulk.lines} running={bulk.running} title={bulk.title} />
      {data.length === 0 && <Notice tone="info">No races yet. Use Sync races on the Overview tab.</Notice>}
      <Card className="mt-2">
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Race</th>
                <th>Status</th>
                <th>Type</th>
                <th>Championship</th>
                <th>Live polling</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/admin/races/${r.id}`} className="font-semibold underline decoration-line underline-offset-2">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">{fmtDate(r.date)}</div>
                  </td>
                  <td>
                    <StateBadge state={r.state} />
                  </td>
                  <td>
                    <select className="input py-1" value={r.kind} onChange={(e) => update(r.id, { kind: e.target.value })} aria-label="Type">
                      <option value="race">Race</option>
                      <option value="training">Training/Toss</option>
                    </select>
                  </td>
                  <td>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={r.included} disabled={r.kind !== "race"} onChange={(e) => update(r.id, { included: e.target.checked })} />
                      {r.kind === "race" ? (r.included ? "Counts" : "Excluded") : "–"}
                    </label>
                  </td>
                  <td>
                    <select className="input py-1" value={r.liveMode} onChange={(e) => update(r.id, { liveMode: e.target.value })} aria-label="Live polling">
                      <option value="auto">Auto (race day)</option>
                      <option value="on">On now</option>
                      <option value="off">Off</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      <p className="mt-2 text-xs text-muted">Auto: live polling every 5 minutes from liberation time (06:00 if unknown) for 48 hours, until you press Calculate results.</p>
    </>
  );
}

/** Per-race settings for a competition (e.g. the weighted system's closing day and time). */
function RaceParamsCard({ raceId, result, onSaved }: { raceId: number; result: CompetitionResult; onSaved: () => Promise<void> | void }) {
  const fields = result.competition.raceFields;
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, result.raceParams?.[f.key] === undefined ? "" : String(result.raceParams[f.key])])),
  );
  const save = useAction();
  return (
    <Card title={`${result.competition.name}: race settings`} className="mb-4">
      {!result.raceParams && (
        <div className="mb-3">
          <Notice>Not set yet, so {result.competition.name} doesn't score this race.</Notice>
        </div>
      )}
      <form
        className="flex flex-wrap items-end gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(async () => {
            const r = await post<{ changed: boolean }>(`/api/admin/competitions/${result.competition.id}/races/${raceId}/params`, values);
            await onSaved();
            return r;
          }, (r) => ((r as { changed: boolean }).changed ? "Saved. A new draft was created – review it above and publish." : "Saved."));
        }}
      >
        {fields.map((f) => (
          <label key={f.key} className="block">
            {f.label}
            <input
              className="input mt-1 w-36"
              type={f.type === "time" ? "time" : "number"}
              min={f.min}
              max={f.max}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
            {f.help && <span className="mt-0.5 block text-xs text-muted">{f.help}</span>}
          </label>
        ))}
        <button className="btn btn-primary" disabled={save.busy || fields.some((f) => !values[f.key])}>
          Save
        </button>
      </form>
      {save.view}
    </Card>
  );
}

function AdminRace() {
  const { id } = useParams();
  const { data, error, reload } = useApi<AdminRaceDetail>(`/api/admin/races/${id}`);
  const action = useAction();
  const [ack, setAck] = useState(false);
  const [dq, setDq] = useState({ scope: "bird" as "bird" | "fancier", target: "", reason: "" });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { race } = data;
  const drafts = data.results.filter((r) => r.draft);
  const warnings = [...new Set(drafts.flatMap((r) => r.draft!.warnings))];
  const act = (fn: () => Promise<unknown>, ok: string | ((r: unknown) => string)) => action.run(async () => {
    const r = await fn();
    await reload();
    return r;
  }, ok);

  return (
    <>
      <PageTitle
        title={race.name}
        sub={
          <span className="flex items-center gap-2">
            {fmtDate(race.date)} <StateBadge state={race.state} />
          </span>
        }
        actions={
          <>
            <button
              className="btn btn-primary"
              disabled={action.busy}
              onClick={() =>
                act(() => post<{ changed: boolean; warnings: string[] }>(`/api/admin/races/${race.id}/calculate`), (r) => {
                  const x = r as { changed: boolean; warnings: string[] };
                  return x.changed ? `Draft created${x.warnings.length ? ` with ${x.warnings.length} note(s)` : ""}. Review it below, then publish.` : "Benzing's result hasn't changed since the last calculation.";
                })
              }
            >
              {action.busy ? "Working…" : "Calculate results"}
            </button>
            <button className="btn" disabled={action.busy || !data.sheetFetchedAt} onClick={() => act(() => post(`/api/admin/races/${race.id}/recalculate`), "Recalculated from stored data.")}>
              Recalculate
            </button>
            <Link className="btn" to={`/races/${race.id}`}>
              Member view
            </Link>
          </>
        }
      />
      {action.view}
      <p className="mb-4 text-sm text-muted">
        Benzing result used: {data.resultTypes.find((t) => t.id === data.fullResultId)?.typeName ?? "none with 100 % of arrivals yet"} · last import {fmtDateTime(data.sheetFetchedAt)}
        {data.benzingRecalculated && ` · Benzing recalculated ${data.benzingRecalculated}`}
      </p>

      {drafts.length > 0 && (
        <Card title="Drafts – not visible to members" className="mb-4 border-accent">
          {warnings.length > 0 && (
            <div className="mb-3">
              <Notice>
                <strong>Check before publishing:</strong>
                <ul className="mt-1 list-disc pl-5">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Notice>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I've checked these and want to publish anyway
              </label>
            </div>
          )}
          {drafts.map((r) => (
            <div key={r.competition.slug} className="mb-5">
              <h3 className="mb-2 font-semibold">{r.competition.name}</h3>
              <ScoreTable calc={r.draft!} rules={r.competition.rules} />
            </div>
          ))}
          <button
            className="btn btn-primary"
            disabled={action.busy || (warnings.length > 0 && !ack)}
            onClick={() => act(() => post(`/api/admin/races/${race.id}/publish`, { acknowledgeWarnings: ack }), "Published. Members can now see these results.")}
          >
            Publish {drafts.length > 1 ? `all ${drafts.length} results` : ""}
          </button>
          {data.results.some((r) => r.draft && r.published) && <p className="mt-2 text-xs text-muted">Publishing replaces the results currently shown to members.</p>}
        </Card>
      )}

      {data.results.filter((r) => r.competition.raceFields.length > 0 && r.competition.active).map((r) => (
        <RaceParamsCard key={`params-${r.competition.slug}-${JSON.stringify(r.raceParams)}`} raceId={race.id} result={r} onSaved={reload} />
      ))}

      {data.results.map((r) => (
        <Card
          key={r.competition.slug}
          title={`Published: ${r.competition.name}${r.competition.active ? "" : " (inactive)"}${r.competition.visibility === "admin" ? " (admin only)" : ""}`}
          className="mb-4"
        >
          {r.published ? <ScoreTable calc={r.published} /> : <p className="text-sm text-muted">Nothing published yet.</p>}
        </Card>
      ))}

      <Card title="Disqualifications" className="mb-4">
        <p className="mb-3 text-sm text-muted">The bird (or all of a fancier's birds) is removed before scoring, so that fancier's next bird moves up. A new draft is created for you to publish.</p>
        <form
          className="grid gap-2 sm:grid-cols-[auto_1fr_2fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => post(`/api/admin/races/${race.id}/overrides`, dq), "Disqualification recorded; new draft created.").then((r) => r && setDq({ ...dq, target: "", reason: "" }));
          }}
        >
          <select className="input" value={dq.scope} onChange={(e) => setDq({ ...dq, scope: e.target.value as "bird" | "fancier", target: "" })} aria-label="Type">
            <option value="bird">Bird</option>
            <option value="fancier">Fancier</option>
          </select>
          {dq.scope === "bird" ? (
            <input className="input" placeholder="Ring, e.g. ZA-2025-BORD-3404" value={dq.target} onChange={(e) => setDq({ ...dq, target: e.target.value })} list="rings" />
          ) : (
            <select className="input" value={dq.target} onChange={(e) => setDq({ ...dq, target: e.target.value })} aria-label="Fancier">
              <option value="">Choose fancier</option>
              {data.entries.map((f) => (
                <option key={f.fancierId} value={f.fancierId}>
                  {f.fancierName}
                </option>
              ))}
            </select>
          )}
          <input className="input" placeholder="Reason (required)" value={dq.reason} onChange={(e) => setDq({ ...dq, reason: e.target.value })} />
          <button className="btn btn-danger" disabled={action.busy || !dq.target || !dq.reason.trim()}>
            Disqualify
          </button>
          <datalist id="rings">
            {data.fullResult.map((r) => (
              <option key={r.ring} value={r.ring}>
                {r.fancierName}
              </option>
            ))}
          </datalist>
        </form>
        {data.overrides.length > 0 && (
          <ul className="mt-3 divide-y divide-line text-sm">
            {data.overrides.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                <span className={o.revoked_at ? "text-muted line-through" : ""}>
                  {o.scope === "bird" ? o.target : data.entries.find((e) => String(e.fancierId) === o.target)?.fancierName ?? `Fancier ${o.target}`} – {o.reason}
                  <span className="block text-xs text-muted">
                    {o.actor}, {fmtDateTime(o.created_at)}
                    {o.revoked_at && ` · revoked by ${o.revoked_by}`}
                  </span>
                </span>
                {!o.revoked_at && (
                  <button className="btn" disabled={action.busy} onClick={() => act(() => post(`/api/admin/overrides/${o.id}/revoke`), "Revoked; new draft created.")}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

interface AdminCompetition extends CompetitionInfo {
  excludedRaceIds: number[];
}
interface SystemInfo {
  id: string;
  name: string;
  fields: { key: string; label: string; type: "integer" | "time"; min?: number; max?: number }[];
  raceFields?: { key: string; label: string }[];
  defaults: Record<string, unknown>;
}

function CompetitionEditor({ comp, systems, races, season, onSaved }: { comp: AdminCompetition; systems: SystemInfo[]; races: RaceSummary[]; season: number; onSaved: () => void }) {
  const system = systems.find((s) => s.id === comp.system);
  const [name, setName] = useState(comp.name);
  const [params, setParams] = useState<Record<string, unknown>>(comp.params);
  const [racesCounted, setRacesCounted] = useState(comp.racesCounted);
  const [bestX, setBestX] = useState<number | null>(comp.bestX);
  const [visibility, setVisibility] = useState(comp.visibility);
  const save = useAction();
  const raceAction = useAction();
  return (
    <Card title={comp.name} right={<span className="text-xs text-muted">{comp.systemName}</span>} className="mb-4">
      <form
        className="grid gap-3 text-sm sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(async () => {
            const r = await post<{ newDrafts: number }>(`/api/admin/competitions/${comp.id}`, { name, params, racesCounted, bestX, visibility, season });
            onSaved();
            return r;
          }, (r) => {
            const n = (r as { newDrafts: number }).newDrafts;
            return n ? `Saved. ${n} race(s) have new drafts to review and publish.` : "Saved.";
          });
        }}
      >
        <label className="block">
          Name
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {system?.fields.map((f) => (
          <label key={f.key} className="block">
            {f.label}
            <input className="input mt-1" type="number" min={f.min} max={f.max} value={String(params[f.key] ?? "")} onChange={(e) => setParams({ ...params, [f.key]: Number(e.target.value) })} />
          </label>
        ))}
        <label className="block">
          Who can see it
          <select className="input mt-1" value={visibility} onChange={(e) => setVisibility(e.target.value as "members" | "admin")}>
            <option value="members">Members and admins</option>
            <option value="admin">Admins only</option>
          </select>
        </label>
        {comp.raceFields.length > 0 && (
          <p className="text-xs text-muted sm:col-span-2">
            {comp.raceFields.map((f) => f.label).join(" and ")} are set per race, on each race's admin page.
          </p>
        )}
        <label className="block">
          Races counted
          <select className="input mt-1" value={racesCounted} onChange={(e) => setRacesCounted(e.target.value as "all" | "best")}>
            <option value="all">All included races</option>
            <option value="best">Best X races per fancier</option>
          </select>
        </label>
        {racesCounted === "best" && (
          <label className="block">
            X (best races counted)
            <input className="input mt-1" type="number" min={1} value={bestX ?? ""} onChange={(e) => setBestX(Number(e.target.value) || null)} />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button className="btn btn-primary" disabled={save.busy}>
            Save
          </button>
          <button
            type="button"
            className="btn"
            disabled={save.busy}
            onClick={() => save.run(async () => {
              await post(`/api/admin/competitions/${comp.id}`, { active: !comp.active, season });
              onSaved();
            }, comp.active ? "Deactivated: hidden from members." : "Activated.")}
          >
            {comp.active ? "Deactivate" : "Activate"}
          </button>
        </div>
        {save.view}
      </form>
      {races.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold">Races in this competition</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {races
              .filter((r) => r.kind === "race")
              .map((r) => (
                <li key={r.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.included && !comp.excludedRaceIds.includes(r.id)}
                      disabled={!r.included || raceAction.busy}
                      onChange={(e) => raceAction.run(async () => {
                        await post(`/api/admin/competitions/${comp.id}/races/${r.id}`, { included: e.target.checked });
                        onSaved();
                      }, "Updated.")}
                    />
                    {r.name} <span className="text-muted">{fmtDate(r.date)}</span>
                    {!r.included && <span className="text-xs text-muted">(excluded on Races tab)</span>}
                  </label>
                </li>
              ))}
          </ul>
          {raceAction.view}
        </details>
      )}
    </Card>
  );
}

function NewCompetition({ systems, season, onCreated }: { systems: SystemInfo[]; season: number; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [systemId, setSystemId] = useState(systems[0]?.id ?? "");
  const system = systems.find((s) => s.id === systemId);
  const [params, setParams] = useState<Record<string, unknown>>(system?.defaults ?? {});
  const [visibility, setVisibility] = useState<"members" | "admin">("admin");
  const create = useAction();
  return (
    <Card title="Add a competition">
      <form
        className="grid gap-3 text-sm sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create.run(async () => {
            await post("/api/admin/competitions", { name, system: systemId, params, visibility, season });
            setName("");
            onCreated();
          }, "Created. Drafts were made for every race with stored results. Review and publish them.");
        }}
      >
        <label className="block">
          Name
          <input className="input mt-1" placeholder="e.g. 3-bird championship" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          Result / point system
          <select className="input mt-1" value={systemId} onChange={(e) => { setSystemId(e.target.value); setParams(systems.find((s) => s.id === e.target.value)?.defaults ?? {}); }}>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {system?.fields.map((f) => (
          <label key={f.key} className="block">
            {f.label}
            <input className="input mt-1" type="number" min={f.min} max={f.max} value={String(params[f.key] ?? "")} onChange={(e) => setParams({ ...params, [f.key]: Number(e.target.value) })} />
          </label>
        ))}
        <label className="block">
          Who can see it
          <select className="input mt-1" value={visibility} onChange={(e) => setVisibility(e.target.value as "members" | "admin")}>
            <option value="admin">Admins only (while you check it)</option>
            <option value="members">Members and admins</option>
          </select>
        </label>
        {system && (system.raceFields ?? []).length > 0 && (
          <p className="text-xs text-muted sm:col-span-2">This system also needs {(system.raceFields ?? []).map((f) => f.label.toLowerCase()).join(" and ")} set on each race's admin page.</p>
        )}
        <div className="sm:col-span-2">
          <button className="btn btn-primary" disabled={create.busy || !name.trim()}>
            Add competition
          </button>
          {create.view}
        </div>
      </form>
      <p className="mt-3 text-xs text-muted">New point systems are added in code (src/core/scoring/systems.ts) and then appear in this list.</p>
    </Card>
  );
}

function SettingsPage({ season, passwordSet }: { season: number; passwordSet: boolean }) {
  const comps = useApi<{ competitions: AdminCompetition[]; systems: SystemInfo[] }>("/api/admin/competitions");
  const races = useApi<RaceSummary[]>(`/api/admin/races?season=${season}`);
  const [pw, setPw] = useState("");
  const pwAction = useAction();
  if (!comps.data) return <Loading />;
  return (
    <>
      <PageTitle title="Settings" />
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Competitions</h2>
      {comps.data.competitions.map((c) => (
        <CompetitionEditor key={`${c.id}-${c.name}-${JSON.stringify(c.params)}-${c.racesCounted}-${c.bestX}`} comp={c} systems={comps.data!.systems} races={races.data ?? []} season={season} onSaved={() => comps.reload()} />
      ))}
      <NewCompetition systems={comps.data.systems} season={season} onCreated={() => comps.reload()} />
      <p className="mt-2 mb-6 text-xs text-muted">Tie rules: no shared places for birds (Benzing's order decides exact ties); fanciers on equal season totals share a place.</p>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Members</h2>
      <Card title="Club password">
        <p className="mb-3 text-sm text-muted">{passwordSet ? "Members share one password. Changing it signs everyone out." : "Not set yet: members can't sign in."}</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void pwAction.run(() => post("/api/admin/member-password", { password: pw }), "Password changed. Share the new one with members.").then((r) => r && setPw(""));
          }}
        >
          <input className="input" type="text" autoComplete="off" placeholder="New club password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn btn-primary" disabled={pwAction.busy || pw.length < 8}>
            Set
          </button>
        </form>
        {pwAction.view}
      </Card>
    </>
  );
}

function AuditPage() {
  const { data } = useApi<{ id: number; at: string; actor: string; action: string; entity: string | null; entity_id: string | null; detail_json: string | null }[]>("/api/admin/audit");
  if (!data) return <Loading />;
  return (
    <>
      <PageTitle title="Audit log" sub="Latest 200 admin actions" />
      <Card>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDateTime(a.at)}</td>
                  <td>{a.actor}</td>
                  <td className="font-medium">{a.action}</td>
                  <td className="max-w-md truncate text-muted" title={a.detail_json ?? ""}>
                    {a.entity ? `${a.entity} ${a.entity_id ?? ""}` : ""} {a.detail_json?.slice(0, 120)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
