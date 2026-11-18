import { useState } from "react";
import { Link, NavLink, Route, Routes, useParams } from "react-router";
import { post } from "../api";
import { fmtDate, fmtDateTime } from "../format";
import { useApi } from "../hooks";
import { FiveBirdResult } from "../results";
import type { AdminRaceDetail, RaceSummary } from "../types";
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
        <ErrorBox error={overview.error.status === 401 ? "Admin sign-in is needed. Open /admin through Cloudflare Access." : overview.error} />
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

function AdminRaces({ season }: { season: number }) {
  const { data, error, reload } = useApi<RaceSummary[]>(`/api/admin/races?season=${season}`);
  const recalc = useAction();
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
          <button className="btn" disabled={recalc.busy} onClick={() => recalc.run(() => post<{ changed: boolean }[]>("/api/admin/recalculate-season", { season }), (r) => `${(r as { changed: boolean }[]).filter((x) => x.changed).length} new drafts to review.`)}>
            Recalculate season
          </button>
        }
      />
      {recalc.view}
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

function AdminRace() {
  const { id } = useParams();
  const { data, error, reload } = useApi<AdminRaceDetail>(`/api/admin/races/${id}`);
  const action = useAction();
  const [ack, setAck] = useState(false);
  const [dq, setDq] = useState({ scope: "bird" as "bird" | "fancier", target: "", reason: "" });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { race, draft } = data;
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

      {draft ? (
        <Card title="Draft – not visible to members" className="mb-4 border-accent">
          {draft.warnings.length > 0 && (
            <div className="mb-3">
              <Notice>
                <strong>Check before publishing:</strong>
                <ul className="mt-1 list-disc pl-5">
                  {draft.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Notice>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I've checked these and want to publish anyway
              </label>
            </div>
          )}
          <FiveBirdResult calc={draft} />
          <button
            className="btn btn-primary mt-4"
            disabled={action.busy || (draft.warnings.length > 0 && !ack)}
            onClick={() => act(() => post(`/api/admin/races/${race.id}/publish`, { calcId: draft.id, acknowledgeWarnings: ack }), "Published. Members can now see this result.")}
          >
            Publish
          </button>
          {data.fiveBird && <p className="mt-2 text-xs text-muted">Publishing replaces the result currently shown to members.</p>}
        </Card>
      ) : null}

      <Card title="Published result" className="mb-4">
        {data.fiveBird ? <FiveBirdResult calc={data.fiveBird} /> : <p className="text-sm text-muted">Nothing published yet.</p>}
      </Card>

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

function SettingsPage({ season, passwordSet }: { season: number; passwordSet: boolean }) {
  const { data, reload } = useApi<{ scoringBirds: number; racesCounted: "all" | "best"; bestX: number | null; updatedAt: string; updatedBy: string }>("/api/admin/settings");
  const [form, setForm] = useState<{ scoringBirds: number; racesCounted: "all" | "best"; bestX: number | null } | null>(null);
  const [pw, setPw] = useState("");
  const save = useAction();
  const pwAction = useAction();
  if (!data) return <Loading />;
  const f = form ?? { scoringBirds: data.scoringBirds, racesCounted: data.racesCounted, bestX: data.bestX };
  return (
    <>
      <PageTitle title="Settings" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Championship rules">
          <form
            className="space-y-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void save.run(async () => {
                const r = await post<{ newDrafts: number }>("/api/admin/settings", { ...f, season });
                setForm(null);
                await reload();
                return r;
              }, (r) => {
                const n = (r as { newDrafts: number }).newDrafts;
                return n ? `Saved. ${n} race(s) have new drafts to review and publish.` : "Saved.";
              });
            }}
          >
            <label className="block">
              Scoring birds per fancier
              <input className="input mt-1" type="number" min={1} max={50} value={f.scoringBirds} onChange={(e) => setForm({ ...f, scoringBirds: Number(e.target.value) })} />
            </label>
            <label className="block">
              Races counted
              <select className="input mt-1" value={f.racesCounted} onChange={(e) => setForm({ ...f, racesCounted: e.target.value as "all" | "best" })}>
                <option value="all">All included races</option>
                <option value="best">Best X races per fancier</option>
              </select>
            </label>
            {f.racesCounted === "best" && (
              <label className="block">
                X (best races counted)
                <input className="input mt-1" type="number" min={1} value={f.bestX ?? ""} onChange={(e) => setForm({ ...f, bestX: Number(e.target.value) || null })} />
              </label>
            )}
            <p className="text-xs text-muted">
              Tie rule: no shared places for birds (Benzing's order decides exact ties); fanciers on equal season totals share a place. Last changed {fmtDateTime(data.updatedAt)} by {data.updatedBy}.
            </p>
            <button className="btn btn-primary" disabled={save.busy}>
              Save rules
            </button>
            {save.view}
          </form>
        </Card>
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
      </div>
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
