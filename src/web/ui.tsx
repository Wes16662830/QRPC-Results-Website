import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ApiError } from "./api";
import type { RaceState } from "./types";

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {sub && <div className="mt-0.5 text-sm text-muted">{sub}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "", right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`card p-4 ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4">{children}</div>;
}

export function Loading() {
  return <p className="py-10 text-center text-muted">Loading…</p>;
}

export function ErrorBox({ error }: { error: ApiError | Error | string }) {
  const msg = typeof error === "string" ? error : error.message;
  return <div className="rounded-lg border border-bad/30 bg-bad-soft p-3 text-sm text-bad">{msg}</div>;
}

export function Notice({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "info" }) {
  const cls = tone === "warn" ? "border-warn/30 bg-warn-soft text-warn" : "border-line bg-surface-2 text-ink";
  return <div className={`rounded-lg border p-3 text-sm ${cls}`}>{children}</div>;
}

const STATE: Record<RaceState, [string, string]> = {
  upcoming: ["Upcoming", "bg-surface-2 text-muted"],
  live: ["Live", "bg-live text-white"],
  awaiting: ["Awaiting result", "bg-surface-2 text-muted"],
  draft: ["Being checked", "bg-accent-soft text-warn"],
  published: ["Result", "bg-good/15 text-good"],
};

export function StateBadge({ state }: { state: RaceState }) {
  const [label, cls] = STATE[state];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {state === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
      {label}
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (t: T) => void; tabs: [T, string][] }) {
  return (
    <div className="no-print mb-3 flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${value === key ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function FancierLink({ id, name }: { id: string | number; name: string }) {
  if (!/^\d+$/.test(String(id))) return <>{name}</>;
  return (
    <Link to={`/fanciers/${id}`} className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-accent">
      {name}
    </Link>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}
