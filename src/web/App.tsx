import { NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import { useEffect, useState } from "react";
import { post, reloadFresh, STALE_EVENT, tidyReloadParam } from "./api";
import { useApi } from "./hooks";
import { SeasonSelect } from "./season";
import { Loading } from "./ui";
import { HomePage } from "./pages/Home";
import { RacesPage } from "./pages/Races";
import { RacePage } from "./pages/Race";
import { LivePage } from "./pages/Live";
import { ChampionshipPage } from "./pages/Championship";
import { FancierPage } from "./pages/Fancier";
import { RulesPage } from "./pages/Rules";
import { LeaderboardPage } from "./pages/Leaderboard";
import { LoginPage } from "./pages/Login";
import { AdminApp } from "./admin/Admin";

const NAV: [string, string][] = [
  ["/", "Home"],
  ["/races", "Races"],
  ["/live", "Live"],
  ["/championship", "Standings"],
  ["/rules", "Rules"],
];

function Header({ admin, member }: { admin: boolean; member: boolean }) {
  return (
    <header className="no-print bg-brand text-brand-ink">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <NavLink to="/" className="flex items-center gap-2 font-bold">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="hidden whitespace-nowrap min-[480px]:inline">QRPC Results</span>
          <span className="min-[480px]:hidden">QRPC</span>
        </NavLink>
        <SeasonSelect />
        <nav className="hidden gap-1 md:flex">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? "bg-white/15" : "opacity-85 hover:opacity-100"}`}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2 text-sm">
          {admin && (
            <a href="/admin" className="rounded-md bg-accent px-2.5 py-1 font-semibold text-[#1b1300]">
              Admin
            </a>
          )}
          {member && (
            <button
              className="whitespace-nowrap opacity-80 hover:opacity-100"
              onClick={async () => {
                await post("/api/logout");
                window.location.href = "/login";
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function BottomNav() {
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="grid grid-cols-5">
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `py-3 text-center text-xs font-semibold ${isActive ? "text-brand dark:text-accent" : "text-muted"}`}>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function StaleBanner() {
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    tidyReloadParam();
    const on = (e: Event) => setServer((e as CustomEvent<string>).detail ?? "new");
    window.addEventListener(STALE_EVENT, on);
    return () => window.removeEventListener(STALE_EVENT, on);
  }, []);
  if (!server) return null;
  return (
    <div className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-center gap-3 bg-accent px-4 py-2 text-sm font-semibold text-[#1b1300]">
      The site has been updated.
      <button className="rounded-md bg-[#1b1300] px-3 py-1 text-white" onClick={() => reloadFresh(server)}>
        Reload
      </button>
      <button className="px-1 text-base leading-none" aria-label="Dismiss" onClick={() => setServer(null)}>
        ✕
      </button>
    </div>
  );
}

export function App() {
  const session = useApi<{ member: boolean; admin: boolean }>("/api/session");
  const location = useLocation();
  if (session.loading && !session.data) return <Loading />;
  const member = session.data?.member ?? false;
  const admin = session.data?.admin ?? false;
  const isAdminPath = location.pathname.startsWith("/admin");

  if (!member && !isAdminPath && location.pathname !== "/login") return <Navigate to="/login" replace />;

  return (
    <div className="min-h-dvh pb-20 md:pb-8">
      <StaleBanner />
      {location.pathname !== "/login" && <Header admin={admin} member={member} />}
      <main className="mx-auto max-w-5xl px-4 py-5">
        <Routes>
          <Route path="/login" element={<LoginPage onLoggedIn={session.reload} />} />
          <Route path="/" element={<HomePage />} />
          <Route path="/races" element={<RacesPage />} />
          <Route path="/races/:id" element={<RacePage />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/championship" element={<ChampionshipPage />} />
          <Route path="/fanciers/:id" element={<FancierPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="*" element={<p className="text-muted">Page not found.</p>} />
        </Routes>
      </main>
      {member && !isAdminPath && location.pathname !== "/login" && <BottomNav />}
    </div>
  );
}
